/**
 * 投资收益记录器
 * 录入方式：每次记录日期、总金额、累计收益。
 * 自动计算：本金、区间段收益、区间段收益率、区间段充值金额。
 */

const STORAGE_KEY = 'investTrackerData';
const DATA_DIR = 'investTracker';
const DATA_FILE = 'data.json';

let state = {
  channels: [],
  currentChannelId: null,
  editingChannelId: null,
};

/* ---------- 初始化 ---------- */

let lastBackTime = 0;
let isAuthenticated = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  bindEvents();
  runSelfTests();
  initBackButton();
  initBiometric();
});

function initBiometric() {
  const lockScreen = document.getElementById('lockScreen');
  const btnUnlock = document.getElementById('btnUnlock');
  const lockError = document.getElementById('lockError');
  const app = document.getElementById('app');

  // Check if biometric is available
  const isCapacitor = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuth;
  
  if (!isCapacitor) {
    // Browser - skip biometric
    lockScreen.classList.add('hidden');
    app.classList.remove('hidden');
    renderDashboard();
    return;
  }

  // Show lock screen
  app.classList.add('hidden');
  lockScreen.classList.remove('hidden');

  btnUnlock.addEventListener('click', async () => {
    try {
      const result = await window.Capacitor.Plugins.BiometricAuth.verify({
        reason: '请验证指纹以访问投资记录',
      });
      
      if (result.verified) {
        isAuthenticated = true;
        lockScreen.classList.add('hidden');
        app.classList.remove('hidden');
        renderDashboard();
      } else {
        lockError.textContent = '验证失败，请重试';
        lockError.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Biometric error:', error);
      // If biometric fails or is cancelled, still allow access
      isAuthenticated = true;
      lockScreen.classList.add('hidden');
      app.classList.remove('hidden');
      renderDashboard();
    }
  });
}

function initBackButton() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
      const viewChannel = document.getElementById('viewChannel');
      const isOnChannelDetail = !viewChannel.classList.contains('hidden');

      if (isOnChannelDetail) {
        // On channel detail page, go back to dashboard
        state.currentChannelId = null;
        showView('viewDashboard');
        renderDashboard();
      } else {
        // On dashboard, double tap to exit
        const now = Date.now();
        if (now - lastBackTime < 2000) {
          window.Capacitor.Plugins.App.exitApp();
        } else {
          lastBackTime = now;
          showToast('再按一次退出应用');
        }
      }
    });
  }
}

/* ---------- 数据模型 ---------- */

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChannel(name) {
  return {
    id: createId(),
    name: name.trim(),
    records: [],
  };
}

function createRecord(date, totalValue, cumulativeReturn) {
  const total = parseFloat(totalValue) || 0;
  const cumulative = parseFloat(cumulativeReturn) || 0;
  return {
    id: createId(),
    date,
    totalValue: total,
    cumulativeReturn: cumulative,
    principal: 0,
    intervalReturn: 0,
    intervalReturnRate: 0,
    intervalRecharge: 0,
  };
}

/* ---------- 计算逻辑 ---------- */

/**
 * 根据前一条记录和当前输入，计算本金、区间收益、收益率、充值金额。
 * @param {object|null} prevRecord 上一条记录
 * @param {number} currentTotal 当前总金额
 * @param {number} currentCumulative 当前累计收益
 */
function calculateRecord(prevRecord, currentTotal, currentCumulative) {
  const principal = currentTotal - currentCumulative;

  const prevTotal = prevRecord ? prevRecord.totalValue : 0;
  const prevCumulative = prevRecord ? prevRecord.cumulativeReturn : 0;
  const prevPrincipal = prevRecord ? (prevTotal - prevCumulative) : 0;

  const intervalReturn = currentCumulative - prevCumulative;
  const intervalRecharge = principal - prevPrincipal;

  let intervalReturnRate = 0;
  if (prevPrincipal > 0) {
    intervalReturnRate = (intervalReturn / prevPrincipal) * 100;
  }

  return {
    principal,
    intervalReturn,
    intervalReturnRate,
    intervalRecharge,
  };
}

/**
 * 重新计算整个渠道所有记录的派生字段。
 */
function recalcChannel(channel) {
  const sorted = channel.records.sort((a, b) => new Date(a.date) - new Date(b.date));
  let previous = null;
  sorted.forEach((record) => {
    const result = calculateRecord(previous, record.totalValue, record.cumulativeReturn);
    record.principal = result.principal;
    record.intervalReturn = result.intervalReturn;
    record.intervalReturnRate = result.intervalReturnRate;
    record.intervalRecharge = result.intervalRecharge;
    previous = record;
  });
  channel.records = sorted;
}

/* ---------- 持久化 ---------- */

function getFilesystem() {
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
    return window.Capacitor.Plugins.Filesystem;
  }
  return null;
}

async function saveData() {
  const data = JSON.stringify(state.channels);

  // 本地文件持久化（手机端优先，不会被清缓存删掉）
  const fs = getFilesystem();
  if (fs) {
    try {
      await fs.writeFile({
        path: `${DATA_DIR}/${DATA_FILE}`,
        data,
        directory: 'DATA',
        recursive: true,
        encoding: 'utf8',
      });
    } catch (e) {
      console.error('Filesystem save failed:', e);
      showToast('文件保存失败');
    }
  }

  // 浏览器调试或降级备份
  try {
    localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.error('localStorage save failed:', e);
    if (!fs) {
      showToast('保存失败：存储空间不足');
    }
  }
}

async function loadData() {
  const fs = getFilesystem();

  if (fs) {
    try {
      const result = await fs.readFile({
        path: `${DATA_DIR}/${DATA_FILE}`,
        directory: 'DATA',
        encoding: 'utf8',
      });
      if (result && result.data) {
        state.channels = JSON.parse(result.data);
        state.channels.forEach(recalcChannel);
        return;
      }
    } catch (e) {
      // 文件不存在或读取失败，尝试 localStorage 迁移
      console.log('Filesystem load failed, falling back to localStorage:', e);
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.channels = JSON.parse(raw);
      state.channels.forEach(recalcChannel);
      // 如果本地文件不存在但 localStorage 有数据，迁移到文件
      if (fs && state.channels.length > 0) {
        saveData();
      }
    }
  } catch (e) {
    console.error('Load failed:', e);
    state.channels = [];
  }
}

/* ---------- CRUD ---------- */

async function addChannel(name) {
  if (!name || !name.trim()) {
    showToast('请输入渠道名称');
    return null;
  }
  const channel = createChannel(name);
  state.channels.unshift(channel);
  await saveData();
  return channel;
}

async function updateChannelName(id, name) {
  const channel = state.channels.find((c) => c.id === id);
  if (!channel) return false;
  if (!name || !name.trim()) {
    showToast('请输入渠道名称');
    return false;
  }
  channel.name = name.trim();
  await saveData();
  return true;
}

async function deleteChannel(id) {
  if (!confirm('确定要删除该渠道及其所有记录吗？')) return;
  state.channels = state.channels.filter((c) => c.id !== id);
  if (state.currentChannelId === id) {
    state.currentChannelId = null;
    showView('viewDashboard');
  }
  await saveData();
  renderDashboard();
}

async function addRecord(channelId, date, totalValue, cumulativeReturn) {
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return false;

  const total = parseFloat(totalValue);
  if (isNaN(total)) {
    showToast('请输入有效的总金额');
    return false;
  }

  const cumulative = parseFloat(cumulativeReturn);
  if (isNaN(cumulative)) {
    showToast('请输入有效的累计收益');
    return false;
  }

  if (cumulative > total) {
    showToast('累计收益不能大于总金额');
    return false;
  }

  const record = createRecord(date, total, cumulative);
  channel.records.push(record);
  recalcChannel(channel);
  await saveData();
  return true;
}

async function deleteRecord(channelId, recordId) {
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return;
  if (!confirm('确定删除这条记录？')) return;
  channel.records = channel.records.filter((r) => r.id !== recordId);
  recalcChannel(channel);
  await saveData();
  renderChannelDetail(channelId);
  renderDashboard();
}

/* ---------- 视图渲染 ---------- */

function showView(viewId) {
  document.getElementById('viewDashboard').classList.add('hidden');
  document.getElementById('viewChannel').classList.add('hidden');
  document.getElementById(viewId).classList.remove('hidden');
}

function formatMoney(value) {
  const num = Number(value) || 0;
  const sign = num > 0 ? '+' : '';
  return `${sign}¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  const num = Number(value) || 0;
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function moneyClass(value) {
  const num = Number(value) || 0;
  if (num > 0) return 'text-positive';
  if (num < 0) return 'text-negative';
  return 'text-primary';
}

function renderDashboard() {
  const listEl = document.getElementById('channelsList');
  const channelCountEl = document.getElementById('channelCount');
  const recordCountEl = document.getElementById('recordCount');
  const yearReturnEl = document.getElementById('yearReturn');
  const yearRechargeEl = document.getElementById('yearRecharge');
  const yearReturnRateEl = document.getElementById('yearReturnRate');

  const currentYear = new Date().getFullYear();
  let totalRecords = 0;
  let yearReturn = 0;
  let yearRecharge = 0;
  let principalAtStartOfYear = 0;

  state.channels.forEach((channel) => {
    const latest = channel.records[channel.records.length - 1];
    if (latest) {
      totalRecords += channel.records.length;
    }

    // Find principal at start of year (last record before current year)
    const sortedRecords = [...channel.records].sort((a, b) => new Date(a.date) - new Date(b.date));
    let lastRecordBeforeYear = null;
    let firstRecordThisYear = null;

    sortedRecords.forEach((record) => {
      const recordYear = new Date(record.date).getFullYear();
      if (recordYear < currentYear) {
        lastRecordBeforeYear = record;
      }
      if (recordYear === currentYear) {
        yearReturn += record.intervalReturn;
        yearRecharge += record.intervalRecharge;
        if (!firstRecordThisYear) firstRecordThisYear = record;
      }
    });

    // Use last record before year, or first record of this year if no prior records
    if (lastRecordBeforeYear) {
      principalAtStartOfYear += lastRecordBeforeYear.totalValue - lastRecordBeforeYear.cumulativeReturn;
    } else if (firstRecordThisYear) {
      principalAtStartOfYear += firstRecordThisYear.principal - firstRecordThisYear.intervalRecharge;
    }
  });

  channelCountEl.textContent = state.channels.length;
  recordCountEl.textContent = totalRecords;
  yearReturnEl.textContent = `¥${Math.abs(yearReturn).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  yearReturnEl.className = `text-xl font-bold num-highlight ${yearReturn >= 0 ? 'text-white' : 'text-red-300'}`;
  yearRechargeEl.textContent = `¥${Math.abs(yearRecharge).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  yearRechargeEl.className = `text-xl font-bold num-highlight ${yearRecharge >= 0 ? 'text-white' : 'text-red-300'}`;

  // Calculate year return rate
  let yearReturnRate = 0;
  if (principalAtStartOfYear > 0) {
    yearReturnRate = (yearReturn / principalAtStartOfYear) * 100;
  }
  yearReturnRateEl.textContent = `${yearReturnRate >= 0 ? '+' : ''}${yearReturnRate.toFixed(2)}%`;
  yearReturnRateEl.className = `text-lg font-bold num-highlight ${yearReturnRate >= 0 ? 'text-white' : 'text-red-300'}`;

  if (state.channels.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 px-6">
        <div class="w-16 h-16 mx-auto mb-4 bg-positive-soft rounded-3xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <p class="font-semibold text-primary mb-1">还没有投资渠道</p>
        <p class="text-xs text-muted">点击"新增"按钮开始记录收益</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = state.channels
    .map((channel, index) => {
      const latest = channel.records[channel.records.length - 1];
      const recordCount = channel.records.length;

      // Calculate year stats for this channel
      let chYearReturn = 0;
      let chYearRecharge = 0;
      let chPrincipalAtStart = 0;
      const sortedRecords = [...channel.records].sort((a, b) => new Date(a.date) - new Date(b.date));
      let lastRecordBeforeYear = null;
      let firstRecordThisYear = null;

      sortedRecords.forEach((record) => {
        const recordYear = new Date(record.date).getFullYear();
        if (recordYear < currentYear) {
          lastRecordBeforeYear = record;
        }
        if (recordYear === currentYear) {
          chYearReturn += record.intervalReturn;
          chYearRecharge += record.intervalRecharge;
          if (!firstRecordThisYear) firstRecordThisYear = record;
        }
      });

      if (lastRecordBeforeYear) {
        chPrincipalAtStart = lastRecordBeforeYear.totalValue - lastRecordBeforeYear.cumulativeReturn;
      } else if (firstRecordThisYear) {
        chPrincipalAtStart = firstRecordThisYear.principal - firstRecordThisYear.intervalRecharge;
      }

      let chYearReturnRate = 0;
      if (chPrincipalAtStart > 0) {
        chYearReturnRate = (chYearReturn / chPrincipalAtStart) * 100;
      }

      return `
        <div class="card channel-card rounded-2xl p-4 cursor-pointer animate-slide-up" 
             style="animation-delay: ${index * 0.06}s; border-left: 4px solid #059669;"
             onclick="openChannel('${channel.id}')">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-primary text-[15px]">${escapeHtml(channel.name)}</h3>
            <span class="text-[11px] text-muted bg-gray-100 px-2 py-1 rounded-lg">${recordCount} 条</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-emerald-50 rounded-xl px-2 py-2">
              <p class="text-[10px] text-gray-500 mb-0.5">当年收益</p>
              <p class="text-[13px] font-bold num-highlight ${chYearReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}">${formatMoney(chYearReturn)}</p>
            </div>
            <div class="bg-blue-50 rounded-xl px-2 py-2">
              <p class="text-[10px] text-gray-500 mb-0.5">当年充值</p>
              <p class="text-[13px] font-bold num-highlight text-gray-700">${formatMoney(chYearRecharge)}</p>
            </div>
            <div class="bg-gray-50 rounded-xl px-2 py-2">
              <p class="text-[10px] text-gray-500 mb-0.5">当年收益率</p>
              <p class="text-[13px] font-bold num-highlight ${chYearReturnRate >= 0 ? 'text-emerald-600' : 'text-red-500'}">${formatPercent(chYearReturnRate)}</p>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderChannelDetail(channelId) {
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return;

  state.currentChannelId = channelId;
  document.getElementById('channelTitle').textContent = channel.name;

  // Hide delete button if channel has records
  const deleteBtn = document.getElementById('btnDeleteChannel');
  if (channel.records.length > 0) {
    deleteBtn.classList.add('hidden');
  } else {
    deleteBtn.classList.remove('hidden');
  }

  const latest = channel.records[channel.records.length - 1];
  const total = latest ? latest.totalValue : 0;
  const cumulative = latest ? latest.cumulativeReturn : 0;

  const totalEl = document.getElementById('channelTotal');
  const cumulativeEl = document.getElementById('channelCumulative');
  totalEl.textContent = `¥${Math.abs(total).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  cumulativeEl.textContent = `¥${Math.abs(cumulative).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  cumulativeEl.className = `text-2xl font-bold num-highlight ${cumulative >= 0 ? 'text-white' : 'text-red-300'}`;

  const listEl = document.getElementById('recordsList');
  if (channel.records.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 px-6">
        <div class="w-16 h-16 mx-auto mb-4 bg-accent-soft rounded-3xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </div>
        <p class="font-semibold text-primary mb-1">暂无记录</p>
        <p class="text-xs text-muted">点击"记一笔"添加第一条记录</p>
      </div>
    `;
    return;
  }

  const reversed = [...channel.records].reverse();
  listEl.innerHTML = reversed
    .map((record, index) => {
      return `
        <div class="card record-item rounded-2xl p-4 animate-slide-up" style="animation-delay: ${index * 0.05}s">
          <div class="flex items-center justify-between mb-3">
            <span class="text-[13px] font-bold text-primary">${formatDate(record.date)}</span>
            <button onclick="deleteRecord('${channelId}', '${record.id}')" 
                    class="text-[11px] text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
              删除
            </button>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="bg-bg rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">总金额</p>
              <p class="text-[13px] font-bold text-primary num-highlight">${formatMoney(record.totalValue)}</p>
            </div>
            <div class="bg-positive-soft rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">累计收益</p>
              <p class="text-[13px] font-bold num-highlight ${moneyClass(record.cumulativeReturn)}">${formatMoney(record.cumulativeReturn)}</p>
            </div>
            <div class="bg-accent-soft rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">本金余额</p>
              <p class="text-[13px] font-bold text-primary num-highlight">${formatMoney(record.principal)}</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3 mt-2">
            <div class="bg-bg rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">区间收益</p>
              <p class="text-[13px] font-bold num-highlight ${moneyClass(record.intervalReturn)}">${formatMoney(record.intervalReturn)}</p>
            </div>
            <div class="bg-bg rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">收益率</p>
              <p class="text-[13px] font-bold num-highlight ${moneyClass(record.intervalReturnRate)}">${formatPercent(record.intervalReturnRate)}</p>
            </div>
            <div class="bg-bg rounded-xl px-3 py-2.5">
              <p class="text-[10px] text-muted mb-1">充值金额</p>
              <p class="text-[13px] font-bold text-primary num-highlight">${formatMoney(record.intervalRecharge)}</p>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  document.getElementById('btnAddChannel').addEventListener('click', () => openChannelModal());
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('importFile').addEventListener('change', importData);

  document.getElementById('channelModalOverlay').addEventListener('click', closeChannelModal);
  document.getElementById('btnCancelChannel').addEventListener('click', closeChannelModal);
  document.getElementById('btnSaveChannel').addEventListener('click', saveChannelFromModal);
  document.getElementById('channelNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveChannelFromModal();
  });

  document.getElementById('btnBack').addEventListener('click', () => {
    state.currentChannelId = null;
    showView('viewDashboard');
    renderDashboard();
  });
  document.getElementById('btnDeleteChannel').addEventListener('click', async () => {
    if (state.currentChannelId) await deleteChannel(state.currentChannelId);
  });
  document.getElementById('btnAddRecord').addEventListener('click', () => openRecordModal());

  document.getElementById('recordModalOverlay').addEventListener('click', closeRecordModal);
  document.getElementById('btnCancelRecord').addEventListener('click', closeRecordModal);
  document.getElementById('btnSaveRecord').addEventListener('click', saveRecordFromModal);
}

/* ---------- 弹窗控制 ---------- */

function openChannelModal(channelId = null) {
  state.editingChannelId = channelId;
  const input = document.getElementById('channelNameInput');
  const title = document.getElementById('channelModalTitle');

  if (channelId) {
    const channel = state.channels.find((c) => c.id === channelId);
    title.textContent = '编辑渠道';
    input.value = channel ? channel.name : '';
  } else {
    title.textContent = '新增渠道';
    input.value = '';
  }

  document.getElementById('channelModal').classList.remove('hidden');
  setTimeout(() => input.focus(), 100);
}

function closeChannelModal() {
  document.getElementById('channelModal').classList.add('hidden');
  state.editingChannelId = null;
}

async function saveChannelFromModal() {
  const input = document.getElementById('channelNameInput');
  const name = input.value.trim();

  if (state.editingChannelId) {
    if (await updateChannelName(state.editingChannelId, name)) {
      closeChannelModal();
      renderDashboard();
      if (state.currentChannelId === state.editingChannelId) {
        renderChannelDetail(state.currentChannelId);
      }
      showToast('渠道已更新');
    }
  } else {
    const channel = await addChannel(name);
    if (channel) {
      closeChannelModal();
      renderDashboard();
      showToast('渠道已添加');
    }
  }
}

function openChannel(channelId) {
  renderChannelDetail(channelId);
  showView('viewChannel');
}

function openRecordModal() {
  const dateInput = document.getElementById('recordDateInput');
  const totalInput = document.getElementById('recordTotalInput');
  const cumulativeInput = document.getElementById('recordCumulativeInput');

  dateInput.value = new Date().toISOString().split('T')[0];
  totalInput.value = '';
  cumulativeInput.value = '';

  document.getElementById('recordModal').classList.remove('hidden');
  setTimeout(() => totalInput.focus(), 100);
}

function closeRecordModal() {
  document.getElementById('recordModal').classList.add('hidden');
}

async function saveRecordFromModal() {
  if (!state.currentChannelId) return;

  const date = document.getElementById('recordDateInput').value;
  const total = document.getElementById('recordTotalInput').value;
  const cumulative = document.getElementById('recordCumulativeInput').value;

  if (!date) {
    showToast('请选择日期');
    return;
  }

  if (await addRecord(state.currentChannelId, date, total, cumulative)) {
    closeRecordModal();
    renderChannelDetail(state.currentChannelId);
    renderDashboard();
    showToast('记录已保存');
  }
}

/* ---------- 导入导出 ---------- */

function exportData() {
  const dataStr = JSON.stringify(state.channels, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `投资收益备份_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('格式错误');
      imported.forEach((c) => {
        if (!c.id || !c.name || !Array.isArray(c.records)) throw new Error('格式错误');
      });

      if (confirm(`确定导入 ${imported.length} 个渠道的数据？当前数据将被覆盖。`)) {
        state.channels = imported;
        state.channels.forEach(recalcChannel);
        await saveData();
        renderDashboard();
        showView('viewDashboard');
        showToast('数据导入成功');
      }
    } catch (err) {
      showToast('导入失败：文件格式不正确');
      console.error(err);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ---------- 提示 ---------- */

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('opacity-0');
  setTimeout(() => {
    toast.classList.add('opacity-0');
  }, 2200);
}

/* ---------- 自测 ---------- */

function runSelfTests() {
  const tests = [
    {
      name: 'first record principal equals total',
      run: () => {
        const r = calculateRecord(null, 10000, 0);
        return r.principal === 10000 && r.intervalReturn === 0 && r.intervalRecharge === 10000;
      },
    },
    {
      name: 'interval return and rate calculated correctly',
      run: () => {
        const prev = { totalValue: 10000, cumulativeReturn: 0 };
        const r = calculateRecord(prev, 13000, 2000);
        // principal = 11000, prevPrincipal = 10000
        // intervalReturn = 2000, intervalRecharge = 1000, rate = 20%
        return r.intervalReturn === 2000 && r.intervalRecharge === 1000 && r.intervalReturnRate === 20;
      },
    },
    {
      name: 'negative return is handled',
      run: () => {
        const prev = { totalValue: 10000, cumulativeReturn: 0 };
        const r = calculateRecord(prev, 9000, -500);
        return r.intervalReturn === -500 && r.intervalRecharge === 500 && r.intervalReturnRate === -5;
      },
    },
  ];

  tests.forEach((t) => {
    const passed = t.run();
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${t.name}`);
  });
}

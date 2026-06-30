/**
 * 投资收益记录器
 * 录入方式：每次记录日期、总金额、累计收益。
 * 自动计算：本金、区间段收益、区间段收益率、区间段充值金额。
 */

const STORAGE_KEY = 'investTrackerData';
const DATA_DIR = 'investTracker';
const DATA_FILE = 'data.json';
const RECORDS_PER_PAGE = 10;

let state = {
  channels: [],
  currentChannelId: null,
  editingChannelId: null,
  recordsPage: 1,
  allRecords: [],
};

/* ---------- 初始化 ---------- */

let lastBackTime = 0;
let isAuthenticated = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  bindEvents();
  runSelfTests();
  initBackButton();
  
  // Wait for Capacitor to be ready
  if (window.Capacitor) {
    console.log('Capacitor detected, waiting for ready...');
    // Capacitor is already loaded in the webview
    setTimeout(() => {
      initBiometric();
    }, 500);
  } else {
    console.log('No Capacitor, running in browser');
    initBiometric();
  }
});

function initBiometric() {
  const lockScreen = document.getElementById('lockScreen');
  const btnUnlock = document.getElementById('btnUnlock');
  const lockError = document.getElementById('lockError');
  const app = document.getElementById('app');

  // 详细检查 Capacitor 状态
  console.log('=== 指纹验证初始化 ===');
  console.log('window.Capacitor:', !!window.Capacitor);
  console.log('window.Capacitor.Plugins:', window.Capacitor?.Plugins ? Object.keys(window.Capacitor.Plugins) : '不存在');
  console.log('NativeBiometric 插件:', !!window.Capacitor?.Plugins?.NativeBiometric);
  
  const isCapacitor = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric;
  
  if (!isCapacitor) {
    console.log('未检测到指纹插件，可能原因:');
    console.log('1. 在浏览器中运行（非 APK）');
    console.log('2. 插件未正确加载');
    console.log('3. 需要重新构建 APK');
    
    // 浏览器环境 - 跳过指纹验证
    lockScreen.classList.add('hidden');
    app.classList.remove('hidden');
    renderDashboard();
    return;
  }

  // 显示锁屏
  console.log('指纹插件已加载，显示锁屏');
  app.classList.add('hidden');
  lockScreen.classList.remove('hidden');

  btnUnlock.addEventListener('click', async () => {
    console.log('点击验证按钮');
    lockError.classList.add('hidden');
    
    try {
      // 先检查指纹是否可用
      console.log('检查指纹可用性...');
      const availability = await window.Capacitor.Plugins.NativeBiometric.isAvailable();
      console.log('指纹可用性结果:', availability);
      
      if (!availability.isAvailable) {
        lockError.textContent = '设备不支持指纹验证';
        lockError.classList.remove('hidden');
        return;
      }

      // 调用指纹验证
      console.log('调用指纹验证...');
      await window.Capacitor.Plugins.NativeBiometric.verifyIdentity({
        reason: '请验证指纹以访问投资记录',
        title: '指纹验证',
        subtitle: '投资收益记录',
        negativeButtonText: '取消',
      });
      
      console.log('指纹验证成功');
      
      // 验证成功
      isAuthenticated = true;
      lockScreen.classList.add('hidden');
      app.classList.remove('hidden');
      renderDashboard();
      showToast('验证成功');
    } catch (error) {
      console.error('指纹验证错误:', error);
      
      // 根据错误码显示不同提示
      const errorCode = error.code || error.message;
      
      if (errorCode === 'USER_CANCEL' || errorCode === 'UserCanceled') {
        lockError.textContent = '已取消验证';
      } else if (errorCode === 'BIOMETRICS_UNAVAILABLE' || errorCode === 'BiometryNotAvailable') {
        lockError.textContent = '设备不支持指纹验证';
      } else if (errorCode === 'BIOMETRICS_NOT_ENROLLED' || errorCode === 'BiometryNotEnrolled') {
        lockError.textContent = '请先在系统设置中注册指纹';
      } else if (errorCode === 'AUTHENTICATION_FAILED') {
        lockError.textContent = '指纹验证失败，请重试';
      } else if (errorCode === 'USER_LOCKOUT') {
        lockError.textContent = '指纹验证锁定，请稍后再试';
      } else {
        lockError.textContent = `验证出错: ${error.message || '未知错误'}`;
      }
      
      lockError.classList.remove('hidden');
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

const BACKUP_FILE = 'invest_tracker_backup.json';

function getFilesystem() {
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
    return window.Capacitor.Plugins.Filesystem;
  }
  return null;
}

// 请求存储权限
async function requestStoragePermission() {
  const fs = getFilesystem();
  if (!fs) return true; // 浏览器环境跳过

  try {
    // 检查权限状态
    const permission = await fs.checkPermissions();
    console.log('存储权限状态:', permission);
    
    if (permission.publicStorage === 'granted') {
      return true;
    }

    // 请求权限
    const result = await fs.requestPermissions();
    console.log('请求权限结果:', result);
    
    return result.publicStorage === 'granted';
  } catch (e) {
    console.error('权限请求失败:', e);
    return false;
  }
}

// 保存数据
async function saveData() {
  const data = JSON.stringify(state.channels);

  const fs = getFilesystem();
  if (fs) {
    try {
      // 保存到 App 私有目录（无需权限）
      await fs.writeFile({
        path: `${DATA_DIR}/${DATA_FILE}`,
        data,
        directory: 'DATA',
        recursive: true,
        encoding: 'utf8',
      });
      console.log('保存到私有目录成功');
      
      // 请求权限后备份到 Downloads
      const hasPermission = await requestStoragePermission();
      if (hasPermission) {
        await backupToDownloads(data);
      } else {
        console.log('无存储权限，跳过备份');
      }
    } catch (e) {
      console.error('保存失败:', e);
      showToast('文件保存失败');
    }
  }

  // 浏览器备份
  try {
    localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.error('localStorage 保存失败:', e);
  }
}

// 备份到 Downloads 目录
async function backupToDownloads(data) {
  const fs = getFilesystem();
  if (!fs) return;

  try {
    // 使用 Filesystem.Directory.Downloads 常量
    await fs.writeFile({
      path: BACKUP_FILE,
      data,
      directory: 'Downloads',
      encoding: 'utf8',
    });
    console.log('备份到 Downloads 成功');
  } catch (e) {
    console.error('备份到 Downloads 失败:', e);
    // 尝试使用 FilesystemDir.Downloads
    try {
      await fs.writeFile({
        path: BACKUP_FILE,
        data,
        directory: 'DOCUMENTS',
        encoding: 'utf8',
      });
      console.log('备份到 DOCUMENTS 成功');
    } catch (e2) {
      console.error('备份到 DOCUMENTS 也失败:', e2);
    }
  }
}

// 从 Downloads 目录恢复数据
async function restoreFromDownloads() {
  const fs = getFilesystem();
  if (!fs) return false;

  // 请求存储权限
  const hasPermission = await requestStoragePermission();
  if (!hasPermission) {
    console.log('无存储权限，无法恢复备份');
    return false;
  }

  // 尝试从 Downloads 恢复
  try {
    const result = await fs.readFile({
      path: BACKUP_FILE,
      directory: 'Downloads',
      encoding: 'utf8',
    });
    if (result && result.data) {
      const channels = JSON.parse(result.data);
      if (Array.isArray(channels) && channels.length > 0) {
        state.channels = channels;
        state.channels.forEach(recalcChannel);
        await saveData();
        console.log('从 Downloads 恢复成功');
        return true;
      }
    }
  } catch (e) {
    console.log('Downloads 无备份');
  }

  // 尝试从 DOCUMENTS 恢复
  try {
    const result = await fs.readFile({
      path: BACKUP_FILE,
      directory: 'DOCUMENTS',
      encoding: 'utf8',
    });
    if (result && result.data) {
      const channels = JSON.parse(result.data);
      if (Array.isArray(channels) && channels.length > 0) {
        state.channels = channels;
        state.channels.forEach(recalcChannel);
        await saveData();
        console.log('从 DOCUMENTS 恢复成功');
        return true;
      }
    }
  } catch (e) {
    console.log('DOCUMENTS 无备份');
  }

  return false;
}

async function loadData() {
  const fs = getFilesystem();

  // 1. 尝试从 App 私有目录加载
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
      console.log('Filesystem load failed, trying backup:', e);
    }
  }

  // 2. 尝试从 Downloads 备份恢复
  const restored = await restoreFromDownloads();
  if (restored) return;

  // 3. 尝试从 localStorage 加载
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.channels = JSON.parse(raw);
      state.channels.forEach(recalcChannel);
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
  const absNum = Math.abs(num);
  const formatted = absNum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num < 0) {
    return `-¥${formatted}`;
  }
  return `¥${formatted}`;
}

function formatPercent(value) {
  const num = Number(value) || 0;
  const absNum = Math.abs(num);
  const formatted = absNum.toFixed(2);
  if (num < 0) {
    return `-${formatted}%`;
  }
  return `+${formatted}%`;
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

  state.channels.forEach((channel) => {
    const latest = channel.records[channel.records.length - 1];
    if (latest) {
      totalRecords += channel.records.length;
    }

    // 按日期排序记录
    const sortedRecords = [...channel.records].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // 找到今年的最新一条记录及其上一条
    let latestRecordThisYear = null;
    let prevRecord = null;
    
    for (let i = sortedRecords.length - 1; i >= 0; i--) {
      const recordYear = new Date(sortedRecords[i].date).getFullYear();
      if (recordYear === currentYear) {
        if (!latestRecordThisYear) {
          latestRecordThisYear = sortedRecords[i];
        } else {
          // 这是今年的倒数第二条，就是上一条
          prevRecord = sortedRecords[i];
          break;
        }
      } else if (recordYear < currentYear) {
        // 找到去年的最后一条
        prevRecord = sortedRecords[i];
        break;
      }
    }

    // 当年收益 = 今年最新累计收益 - 上一条累计收益，没有上一条则为0
    if (latestRecordThisYear) {
      const prevCumulative = prevRecord ? prevRecord.cumulativeReturn : 0;
      yearReturn += latestRecordThisYear.cumulativeReturn - prevCumulative;
      
      // 当年充值 = 今年最新本金 - 上一条本金
      const currentPrincipal = latestRecordThisYear.totalValue - latestRecordThisYear.cumulativeReturn;
      const prevPrincipal = prevRecord ? (prevRecord.totalValue - prevRecord.cumulativeReturn) : 0;
      yearRecharge += currentPrincipal - prevPrincipal;
    }
  });

  // 当前所有渠道的总本金
  let totalPrincipal = 0;
  state.channels.forEach((channel) => {
    const latest = channel.records[channel.records.length - 1];
    if (latest) {
      totalPrincipal += latest.totalValue - latest.cumulativeReturn;
    }
  });

  channelCountEl.textContent = state.channels.length;
  recordCountEl.textContent = totalRecords;
  yearReturnEl.textContent = formatMoney(yearReturn);
  yearReturnEl.className = `text-sm font-bold num-highlight ${yearReturn >= 0 ? 'text-red-500' : 'text-emerald-500'}`;
  yearRechargeEl.textContent = formatMoney(totalPrincipal);
  yearRechargeEl.className = `text-sm font-bold num-highlight text-gray-900`;

  // 收益率 = 当年收益 / 当前所有本金
  let yearReturnRate = 0;
  if (totalPrincipal > 0) {
    yearReturnRate = (yearReturn / totalPrincipal) * 100;
  }
  yearReturnRateEl.textContent = formatPercent(yearReturnRate);
  yearReturnRateEl.className = `text-sm font-bold num-highlight ${yearReturnRate >= 0 ? 'text-red-500' : 'text-emerald-500'}`;

  if (state.channels.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 px-4">
        <div class="w-12 h-12 mx-auto mb-3 bg-emerald-100 rounded-2xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <p class="font-semibold text-gray-900 text-sm mb-1">还没有投资渠道</p>
        <p class="text-[11px] text-gray-500">点击"新增"按钮开始记录收益</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = state.channels
    .map((channel, index) => {
      const latest = channel.records[channel.records.length - 1];
      const recordCount = channel.records.length;

      // 计算渠道的年收益统计
      let chYearReturn = 0;
      let chYearRecharge = 0;
      const sortedRecords = [...channel.records].sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // 找到今年的最新一条记录及其上一条
      let latestRecordThisYear = null;
      let prevRecord = null;
      
      for (let i = sortedRecords.length - 1; i >= 0; i--) {
        const recordYear = new Date(sortedRecords[i].date).getFullYear();
        if (recordYear === currentYear) {
          if (!latestRecordThisYear) {
            latestRecordThisYear = sortedRecords[i];
          } else {
            // 这是今年的倒数第二条，就是上一条
            prevRecord = sortedRecords[i];
            break;
          }
        } else if (recordYear < currentYear) {
          // 找到去年的最后一条
          prevRecord = sortedRecords[i];
          break;
        }
      }

      // 当年收益 = 今年最新累计收益 - 上一条累计收益，没有上一条则为0
      if (latestRecordThisYear) {
        const prevCumulative = prevRecord ? prevRecord.cumulativeReturn : 0;
        chYearReturn = latestRecordThisYear.cumulativeReturn - prevCumulative;
        
        // 当年充值 = 今年最新本金 - 上一条本金
        const currentPrincipal = latestRecordThisYear.totalValue - latestRecordThisYear.cumulativeReturn;
        const prevPrincipal = prevRecord ? (prevRecord.totalValue - prevRecord.cumulativeReturn) : 0;
        chYearRecharge = currentPrincipal - prevPrincipal;
      }

      // 当前渠道的本金
      const chCurrentPrincipal = latest ? (latest.totalValue - latest.cumulativeReturn) : 0;

      // 收益率 = 当年收益 / 当前本金
      let chYearReturnRate = 0;
      if (chCurrentPrincipal > 0) {
        chYearReturnRate = (chYearReturn / chCurrentPrincipal) * 100;
      }

      return `
        <div class="card channel-card rounded-xl p-3 cursor-pointer animate-slide-up" 
             style="animation-delay: ${index * 0.06}s;"
             onclick="openChannel('${channel.id}')">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-gray-900 text-sm">${escapeHtml(channel.name)}</h3>
            <span class="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">${recordCount} 条</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-gray-50 rounded-lg px-2 py-1.5">
              <p class="text-[9px] text-gray-500 mb-0.5">当年收益</p>
              <p class="text-[11px] font-bold num-highlight ${chYearReturn >= 0 ? 'text-red-500' : 'text-emerald-500'}">${formatMoney(chYearReturn)}</p>
            </div>
            <div class="bg-gray-50 rounded-lg px-2 py-1.5">
              <p class="text-[9px] text-gray-500 mb-0.5">本金余额</p>
              <p class="text-[11px] font-bold num-highlight text-gray-900">${formatMoney(chCurrentPrincipal)}</p>
            </div>
            <div class="bg-gray-50 rounded-lg px-2 py-1.5">
              <p class="text-[9px] text-gray-500 mb-0.5">当年收益率</p>
              <p class="text-[11px] font-bold num-highlight ${chYearReturnRate >= 0 ? 'text-red-500' : 'text-emerald-500'}">${formatPercent(chYearReturnRate)}</p>
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
  state.recordsPage = 1;
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
  totalEl.textContent = formatMoney(total);
  totalEl.className = `text-base font-bold num-highlight text-gray-900`;
  cumulativeEl.textContent = formatMoney(cumulative);
  cumulativeEl.className = `text-base font-bold num-highlight text-gray-900`;

  const listEl = document.getElementById('recordsList');
  if (channel.records.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 px-4">
        <div class="w-12 h-12 mx-auto mb-3 bg-emerald-100 rounded-2xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </div>
        <p class="font-semibold text-gray-900 text-sm mb-1">暂无记录</p>
        <p class="text-[11px] text-gray-500">点击"记一笔"添加第一条记录</p>
      </div>
    `;
    return;
  }

  // 保存所有记录用于分页加载
  state.allRecords = [...channel.records].reverse();
  const totalPages = Math.ceil(state.allRecords.length / RECORDS_PER_PAGE);
  const recordsToShow = state.allRecords.slice(0, RECORDS_PER_PAGE);

  listEl.innerHTML = renderRecordItems(recordsToShow, channelId);

  // 如果还有更多记录，添加加载提示
  if (totalPages > 1) {
    listEl.innerHTML += `
      <div id="loadMoreTrigger" class="text-center py-4 text-xs text-gray-400">
        上拉加载更多...
      </div>
    `;
  }

  // 初始化滚动加载
  initRecordsScroll();
}

function renderRecordItems(records, channelId) {
  return records.map((record, index) => {
    return `
      <div class="card record-item rounded-xl p-3 animate-slide-up" style="animation-delay: ${index * 0.05}s">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[12px] font-bold text-gray-900">${formatDate(record.date)}</span>
          <button onclick="deleteRecord('${channelId}', '${record.id}')" 
                  class="text-[10px] text-red-500 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors">
            删除
          </button>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">总金额</p>
            <p class="text-[11px] font-bold text-gray-900 num-highlight">${formatMoney(record.totalValue)}</p>
          </div>
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">累计收益</p>
            <p class="text-[11px] font-bold num-highlight ${moneyClass(record.cumulativeReturn)}">${formatMoney(record.cumulativeReturn)}</p>
          </div>
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">本金余额</p>
            <p class="text-[11px] font-bold text-gray-900 num-highlight">${formatMoney(record.principal)}</p>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-1.5">
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">区间收益</p>
            <p class="text-[11px] font-bold num-highlight ${moneyClass(record.intervalReturn)}">${formatMoney(record.intervalReturn)}</p>
          </div>
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">收益率</p>
            <p class="text-[11px] font-bold num-highlight ${moneyClass(record.intervalReturnRate)}">${formatPercent(record.intervalReturnRate)}</p>
          </div>
          <div class="bg-gray-50 rounded-lg px-2 py-1.5">
            <p class="text-[9px] text-gray-500 mb-0.5">充值金额</p>
            <p class="text-[11px] font-bold text-gray-900 num-highlight">${formatMoney(record.intervalRecharge)}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function loadMoreRecords() {
  if (!state.currentChannelId) return;

  const channel = state.channels.find((c) => c.id === state.currentChannelId);
  if (!channel) return;

  const totalPages = Math.ceil(state.allRecords.length / RECORDS_PER_PAGE);
  if (state.recordsPage >= totalPages) return;

  state.recordsPage++;
  const endIdx = state.recordsPage * RECORDS_PER_PAGE;
  const recordsToShow = state.allRecords.slice(0, endIdx);

  const listEl = document.getElementById('recordsList');
  const trigger = document.getElementById('loadMoreTrigger');

  if (trigger) {
    trigger.remove();
  }

  listEl.innerHTML = renderRecordItems(recordsToShow, state.currentChannelId);

  // 如果还有更多记录，添加加载提示
  if (state.recordsPage < totalPages) {
    listEl.innerHTML += `
      <div id="loadMoreTrigger" class="text-center py-4 text-xs text-gray-400">
        上拉加载更多...
      </div>
    `;
  }
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

// 无限滚动加载更多记录
let scrollListenerAttached = false;

function initRecordsScroll() {
  if (scrollListenerAttached) return;
  
  const scrollContainer = document.getElementById('channelRecordsScroll');
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', () => {
      if (state.currentChannelId && 
          scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 100) {
        loadMoreRecords();
      }
    });
    scrollListenerAttached = true;
  }
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

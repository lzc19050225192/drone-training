const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

const DATA_FILE = path.join(__dirname, 'kb-data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const ADMIN_PASSWORD = 'admin888';

const DEFAULT_KB = [
  {
    id: 1, category: '产品知识',
    question: '请介绍我们公司无人机的三大产品线及其核心应用场景。',
    answer: '我公司拥有三大无人机产品线：①消费娱乐系列：面向个人用户和摄影爱好者，代表型号为Mini 4K和Air 3，主打便携性和画质；②行业测绘系列：适用于国土测量、工程勘察，代表型号Phantom RTK，精度可达厘米级；③农业植保系列：专为农业用户设计，T40/T50系列支持智能喷洒、飞行规划，亩效率提升5倍以上。',
    keypoints: '提到三大产品线,列举代表机型,说明应用场景'
  },
  {
    id: 2, category: '销售技巧',
    question: '客户询问"你们的无人机和竞品相比有什么优势"，你应该如何回答？',
    answer: '可从四个维度回答：①技术领先：自研飞控芯片+APAS智能避障，市场成熟度业界第一；②生态完整：配套App、配件、售后网络覆盖全国500+城市；③性价比突出：同级别性能价格低10-20%；④服务保障：1年免费保修+7×24小时技术支持热线。建议结合客户具体痛点针对性突出一到两点。',
    keypoints: '提到技术优势,提到服务体系,结合客户需求'
  },
  {
    id: 3, category: '行业法规',
    question: '客户问"无人机飞行需要考证吗？有哪些限制区域？"，请详细说明。',
    answer: '根据民航局规定：①重量≤250g的微型无人机无需证书，可在视距内飞行；②250g~7kg需取得CAAC无人机执照（无人机驾驶员合格证）；③商业用途无论重量均需持证。禁飞区包括：机场净空区（半径8km）、军事禁区、政府机关上空、人员密集区、高速公路上方等。建议客户在使用前务必查阅当地最新法规，并开启官方App的实时禁飞区提醒功能。',
    keypoints: '区分重量等级,说明证书要求,列举禁飞区类型'
  },
  {
    id: 4, category: '客户服务',
    question: '客户反馈"无人机买回去两周就出现图传信号不稳定"，你如何处理？',
    answer: '处理步骤：①首先安抚客户情绪，表达重视；②引导客户排查：检查App版本/固件是否最新、飞行环境是否有强电磁干扰、遥控器天线朝向是否正确；③若初步排查无效，申请7日内无理由退换或安排就近售后网点免费检测；④全程跟进，48小时内回复处理结果。记录故障信息反馈产品团队。',
    keypoints: '安抚客户,提供自排查步骤,说明售后政策,跟进处理'
  },
  {
    id: 5, category: '销售技巧',
    question: '如何识别客户类型并进行针对性销售话术？',
    answer: '主要分四类：①价格敏感型：突出性价比、分期政策、以旧换新活动；②技术发烧友：深入介绍参数、新功能、对比测评数据；③商业用途型：聚焦ROI（投资回报率）、效率提升、行业成功案例；④礼品采购型：强调包装档次、品牌价值、送礼场景适配度。识别方法：通过提问了解购买目的和预算区间，再对症下药。',
    keypoints: '识别客户类型,差异化话术,提问方法'
  }
];

// ========== 数据读写（原子写入 + 自动备份） ==========

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      writeData(DEFAULT_KB, false);
      return DEFAULT_KB;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('数据格式错误');
    return data;
  } catch (e) {
    console.error('读取数据失败:', e.message);
    // 尝试从最新备份恢复
    const recovered = recoverFromBackup();
    if (recovered) {
      writeData(recovered, false);
      console.log('已从备份恢复数据');
      return recovered;
    }
    writeData(DEFAULT_KB, false);
    return DEFAULT_KB;
  }
}

function writeData(data, doBackup = true) {
  // 自动备份（仅当数据有意义时）
  if (doBackup && data.length > 0) {
    autoBackup(data);
  }
  // 原子写入：先写临时文件，再重命名
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE);
  // 触发 GitHub 同步（防抖）
  scheduleGithubSync(data);
}

// ========== 自动备份 ==========

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function autoBackup(data) {
  try {
    ensureBackupDir();
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `kb-data-${ts}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf-8');
    // 只保留最近 20 个备份
    cleanOldBackups(20);
  } catch (e) {
    console.error('自动备份失败:', e.message);
  }
}

function cleanOldBackups(keep) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('kb-data-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (let i = keep; i < files.length; i++) {
      fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
    }
  } catch (e) {}
}

function recoverFromBackup() {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('kb-data-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(BACKUP_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`从备份恢复: ${file}`);
          return data;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

// ========== GitHub 同步（防抖） ==========

let syncTimer = null;
let lastSyncSha = null;

function syncToGitHub(data) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.log('GitHub 同步跳过: 未设置 GITHUB_TOKEN');
    return;
  }
  
  const https = require('https');
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  
  const options = {
    hostname: 'api.github.com',
    path: '/repos/lzc19050225192/drone-training/contents/kb-data.json',
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'drone-training',
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  // 先获取当前 SHA
  const getReq = https.request({
    hostname: 'api.github.com',
    path: '/repos/lzc19050225192/drone-training/contents/kb-data.json?ref=main',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'drone-training',
      'Accept': 'application/vnd.github.v3+json'
    }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      let sha = null;
      try {
        const parsed = JSON.parse(body);
        sha = parsed.sha;
      } catch (e) {}
      
      const payload = JSON.stringify({
        message: `管理员更新知识库 (${new Date().toISOString().slice(0,19).replace('T',' ')})`,
        content: content,
        branch: 'main',
        ...(sha ? { sha } : {})
      });

      const putReq = https.request(options, (putRes) => {
        let putBody = '';
        putRes.on('data', d => putBody += d);
        putRes.on('end', () => {
          if (putRes.statusCode === 200 || putRes.statusCode === 201) {
            try {
              lastSyncSha = JSON.parse(putBody).content?.sha;
            } catch(e) {}
            console.log('GitHub 同步成功');
          } else {
            // SHA 过期，重置缓存
            lastSyncSha = null;
            console.error('GitHub 同步失败:', putRes.statusCode, putBody.slice(0, 200));
          }
        });
      });
      putReq.on('error', (e) => { lastSyncSha = null; console.error('GitHub 同步网络错误:', e.message); });
      putReq.write(payload);
      putReq.end();
    });
  });
  getReq.on('error', (e) => { console.error('GitHub GET 错误:', e.message); });
  getReq.end();
}

function scheduleGithubSync(data) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncToGitHub(data);
    syncTimer = null;
  }, 3000); // 3 秒防抖
}

// ========== 中间件 ==========

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: '管理员密码错误，无权执行此操作' });
  }
  next();
}

// ========== API 路由 ==========

app.get('/api/kb', (req, res) => {
  const data = readData();
  const result = data.map(item => ({
    id: item.id,
    category: item.category,
    question: item.question,
    answer: item.answer,
    keypoints: item.keypoints || ''
  }));
  res.json(result);
});

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin_session_' + Date.now() });
  } else {
    res.status(403).json({ error: '密码错误' });
  }
});

app.post('/api/kb', requireAdmin, (req, res) => {
  const { category, question, answer, keypoints } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ error: '题目和答案不能为空' });
  }
  const data = readData();
  const maxId = data.length ? Math.max(...data.map(x => x.id)) : 0;
  const newItem = {
    id: maxId + 1,
    category: category || '其他',
    question,
    answer,
    keypoints: keypoints || ''
  };
  data.push(newItem);
  writeData(data);
  res.json({ success: true, item: newItem });
});

app.delete('/api/kb/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  let data = readData();
  const existed = data.find(x => x.id === id);
  if (!existed) {
    return res.status(404).json({ error: '题目不存在' });
  }
  data = data.filter(x => x.id !== id);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/kb/clear', requireAdmin, (req, res) => {
  writeData([]);
  res.json({ success: true });
});

app.post('/api/kb/batch', requireAdmin, (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: '请提供有效的题目列表' });
  }
  const data = readData();
  let maxId = data.length ? Math.max(...data.map(x => x.id)) : 0;
  let count = 0;
  items.forEach(item => {
    if (item.question && item.answer) {
      maxId++;
      data.push({
        id: maxId,
        category: item.category || '其他',
        question: item.question,
        answer: item.answer,
        keypoints: item.keypoints || ''
      });
      count++;
    }
  });
  writeData(data);
  res.json({ success: true, imported: count, total: data.length });
});

app.put('/api/kb/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { category, question, answer, keypoints } = req.body;
  const data = readData();
  const idx = data.findIndex(x => x.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: '题目不存在' });
  }
  if (category !== undefined) data[idx].category = category;
  if (question !== undefined) data[idx].question = question;
  if (answer !== undefined) data[idx].answer = answer;
  if (keypoints !== undefined) data[idx].keypoints = keypoints;
  writeData(data);
  res.json({ success: true, item: data[idx] });
});

// 导出备份
app.get('/api/kb/export', requireAdmin, (req, res) => {
  const data = readData();
  res.setHeader('Content-Disposition', `attachment; filename="kb-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(data);
});

// 查看备份列表
app.get('/api/kb/backups', requireAdmin, (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('kb-data-'))
      .sort()
      .reverse();
    res.json({ backups: files });
  } catch (e) {
    res.json({ backups: [] });
  }
});

// 静态文件
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

process.on('SIGTERM', () => {
  console.log('服务关闭');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  无人机销售培训助手');
  console.log('  http://localhost:' + PORT);
  console.log('  数据文件: ' + DATA_FILE);
  console.log('  备份目录: ' + BACKUP_DIR);
  console.log('  所有用户共享云端知识库');
  console.log('========================================');
  
  // 启动时优先从 GitHub 拉取最新数据
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (GITHUB_TOKEN) {
    console.log('正在从 GitHub 同步最新题库数据...');
    tryFetchFromGithub(GITHUB_TOKEN);
  } else {
    console.log('⚠️ 未设置 GITHUB_TOKEN，题库数据将在重启后丢失');
    console.log('   请在 Railway 环境变量中设置 GITHUB_TOKEN');
  }
});

function tryFetchFromGithub(token) {
  const https = require('https');
  https.get({
    hostname: 'api.github.com',
    path: '/repos/lzc19050225192/drone-training/contents/kb-data.json?ref=main',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'drone-training',
      'Accept': 'application/vnd.github.v3+json'
    }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.content) {
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          fs.writeFileSync(DATA_FILE, content, 'utf-8');
          console.log('已从 GitHub 恢复数据');
        }
      } catch (e) {
        console.log('从 GitHub 恢复数据失败:', e.message);
      }
    });
  }).on('error', (e) => {
    console.log('GitHub 连接失败:', e.message);
  });
}

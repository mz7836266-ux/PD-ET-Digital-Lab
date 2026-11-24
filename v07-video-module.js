
/*
 * PD Finger Motor Lab V0.7
 * Browser-side MP4 → MediaPipe → V0.6 analysis bridge.
 * Research prototype. Not a clinical diagnostic tool.
 */

const v07Main = document.querySelector("main");
const v07Panel = document.createElement("section");
v07Panel.className = "panel";
v07Panel.innerHTML = `
  <h2>视频一体化分析 · V0.7</h2>
  <p>
    直接上传手指对合 MP4 视频，自动提取关键点、
    统计对合候选次数，并计算 V0.6 运动学指标。
  </p>
  <div class="flex">
    <div>
      <label for="v07File">选择 MP4 视频</label>
      <input id="v07File" type="file"
        accept="video/mp4,video/webm,video/quicktime">
    </div>
    <div>
      <label for="v07Fps">分析采样率</label>
      <select id="v07Fps">
        <option value="30" selected>30 次/秒</option>
        <option value="15">15 次/秒（低性能设备）</option>
      </select>
    </div>
  </div>
  <div class="flex" style="margin-top:15px">
    <div>
      <label for="v07Subject">受试者研究编号</label>
      <input id="v07Subject" value="TEST001" maxlength="60">
    </div>
    <div>
      <label for="v07Side">测试手别</label>
      <select id="v07Side">
        <option>右手</option>
        <option>左手</option>
      </select>
    </div>
  </div>
  <div style="margin-top:15px">
    <video id="v07Video"
      controls playsinline preload="metadata"
      style="width:100%;max-height:320px;
        background:#101722;border-radius:12px"></video>
  </div>
  <div style="margin-top:12px">
    <button id="v07Run">分析视频并计算运动学指标</button>
    <button id="v07Cancel" disabled>取消分析</button>
    <button id="v07Export" disabled>下载完整分析 JSON</button>
  </div>
  <div style="height:8px;background:#101722;
      border-radius:6px;overflow:hidden;margin-top:12px">
    <div id="v07Progress"
      style="width:0%;height:100%;background:#13a88d"></div>
  </div>
  <p id="v07Status" class="small">
    未开始。每次仅拍摄一只手，确保拇指和食指清楚可见。
  </p>
  <p class="note small">
    视频在浏览器本地分析，不上传服务器。
    本版使用独立的自适应阈值计数算法，
    结果必须与人工计数核对。
    视频实际帧率尚不能通过本页面完全验证。
  </p>
`;

v07Main.insertBefore(
  v07Panel,
  v07Main.querySelector("section.panel")
);

const v7 = id => document.getElementById(id);
const video7 = v7("v07Video");
const status7 = v7("v07Status");
const canvas7 = document.createElement("canvas");
const ctx7 = canvas7.getContext("2d", {
  willReadFrequently: true
});

let model7 = null;
let canceled7 = false;
let latestRecord7 = null;
let videoUrl7 = null;
let lastModelTimestamp7 = 0;

const pauseUI7 = () => new Promise(
  resolve => requestAnimationFrame(resolve)
);

function setStatus7(message) {
  status7.textContent = message;
}

function distance7(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function median7(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function quantile7(values, p) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return null;
  const position = (a.length - 1) * p;
  const i = Math.floor(position);
  const f = position - i;
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * f;
}

function getIntervals7(events) {
  return events.slice(1).map(
    (e, i) => (e.time_s - events[i].time_s) * 1000
  );
}

function intervalCV7(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce(
    (a, b) => a + (b - mean) ** 2, 0
  ) / values.length;
  return Math.sqrt(variance) / mean * 100;
}

async function initModel7() {
  if (model7) return model7;

  setStatus7("正在从本站加载 MediaPipe 识别库……");

  const moduleUrl = new URL(
    "./vendor/vision_bundle.mjs",
    import.meta.url
  ).href;

  const pkg = await import(moduleUrl);

  if (!pkg.FilesetResolver || !pkg.HandLandmarker) {
    throw new Error(
      "MediaPipe 模块没有导出 FilesetResolver 或 HandLandmarker"
    );
  }

  setStatus7("识别库已加载，正在初始化 WASM……");

  const wasmUrl = new URL(
    "./vendor/wasm",
    import.meta.url
  ).href;

  const vision = await pkg.FilesetResolver.forVisionTasks(wasmUrl);

  setStatus7("WASM 已准备，正在初始化手部模型……");

  const modelUrl = new URL(
    "./model/hand_landmarker.task",
    import.meta.url
  ).href;

  model7 = await pkg.HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  setStatus7("MediaPipe 手部模型初始化成功。");
  return model7;
}

function loadMetadata7(file) {
  return new Promise((resolve, reject) => {
    if (videoUrl7) URL.revokeObjectURL(videoUrl7);

    videoUrl7 = URL.createObjectURL(file);

    video7.onloadedmetadata = () => {
      if (!Number.isFinite(video7.duration) ||
          video7.duration <= 0) {
        reject(new Error("无法取得有效的视频时长"));
      } else {
        resolve();
      }
    };

    video7.onerror = () => reject(
      new Error("浏览器无法解码此视频，请尝试 H.264 MP4")
    );

    video7.src = videoUrl7;
    video7.load();
  });
}

function seekVideo7(t) {
  if (Math.abs(video7.currentTime - t) < 0.003 &&
      video7.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      video7.removeEventListener("seeked", completed);
      video7.removeEventListener("error", failed);
    };

    const completed = () => {
      cleanup();
      resolve();
    };

    const failed = () => {
      cleanup();
      reject(new Error("视频定位或解码失败"));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("视频定位超时，可能不支持逐帧解码"));
    }, 12000);

    video7.addEventListener("seeked", completed);
    video7.addEventListener("error", failed);

    try {
      video7.currentTime = t;
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

// 使用拇指尖(4)与食指尖(8)的二维距离。
// 以腕部(0)至中指MCP(9)作为尺度参考。
function extractDistance7(landmarks, time) {
  if (!landmarks || landmarks.length < 21) return null;

  const handScale = distance7(landmarks[0], landmarks[9]);
  if (!Number.isFinite(handScale) || handScale < 0.025) {
    return null;
  }

  const thumb = landmarks[4];
  const index = landmarks[8];

  return {
    requested_time_s: time,
    actual_video_time_s: video7.currentTime,
    t: time,
    d: distance7(thumb, index) / handScale,
    x: (thumb.x - index.x) / handScale,
    y: (thumb.y - index.y) / handScale,
    hand_scale: handScale
  };
}

// 三点中值滤波 + 自适应双阈值 + 最短事件间隔。
// 这是 V0.7 的候选计数器，不冒充 V0.5.1 原算法。
function detectClosures7(frames, fps) {
  const values = frames.map(f => f.d);
  if (values.length < 15) {
    return { events: [], range: 0, low: null, high: null };
  }

  const smoothed = frames.map((f, i) => {
    const near = frames.slice(
      Math.max(0, i - 1),
      Math.min(frames.length, i + 2)
    ).filter(g => Math.abs(g.t - f.t) <= 1.6 / fps);

    return {
      t: f.t,
      d: median7(near.map(g => g.d))
    };
  });

  const lower = quantile7(smoothed.map(f => f.d), 0.10);
  const upper = quantile7(smoothed.map(f => f.d), 0.90);
  const range = upper - lower;

  if (!Number.isFinite(range) || range < 0.12) {
    return { events: [], range, low: null, high: null };
  }

  const low = lower + 0.25 * range;
  const high = lower + 0.60 * range;

  let opened = false;
  let lastEvent = -Infinity;
  let lastTime = null;
  const events = [];

  for (const f of smoothed) {
    if (lastTime !== null &&
        f.t - lastTime > Math.max(0.18, 3 / fps)) {
      opened = false;
    }

    lastTime = f.t;

    if (f.d >= high) {
      opened = true;
    }

    if (opened && f.d <= low &&
        f.t - lastEvent >= 0.13) {
      events.push({
        time_s: f.t,
        amplitude_normalized: null
      });

      lastEvent = f.t;
      opened = false;
    }
  }

  return { events, range, low, high };
}

function makeRecord7(file, fps, duration, frames, detected, total) {
  const result = detectClosures7(frames, fps);
  const events = result.events;
  const fraction = detected / total;
  const intervals = getIntervals7(events);

  const qualityFlags = [];

  if (fraction < 0.70) {
    qualityFlags.push("关键点检出率不足70%");
  }

  if (result.range < 0.12) {
    qualityFlags.push("手指开合距离变化不足或识别异常");
  }

  if (events.length < 6) {
    qualityFlags.push("有效候选对合事件过少");
  }

  let longestGap = 0;
  for (let i = 1; i < frames.length; i++) {
    longestGap = Math.max(
      longestGap, frames[i].t - frames[i - 1].t
    );
  }

  if (longestGap > 0.20) {
    qualityFlags.push("存在较长关键点缺失区间");
  }

  qualityFlags.push("源视频实际帧率未完全验证");
  qualityFlags.push("V0.7 计数尚需人工对照验证");

  const valid =
    fraction >= 0.70 &&
    result.range >= 0.12 &&
    events.length >= 6;

  return {
    version: "0.7",
    type: "video",
    record_id: "V07-" + Date.now(),
    created_at: new Date().toISOString(),
    subject_id: v7("v07Subject").value.trim() || "TEST",
    visit_id: "S1",
    side: v7("v07Side").value,
    task: "finger",
    file_name: file.name,
    requested_sampling_fps: fps,
    planned_samples: total,
    processed_samples: total,
    detected_samples: detected,
    detected_fraction: fraction,
    record_duration_s: duration,
    source_fps_verified: false,
    quality_flags: qualityFlags,
    metrics: {
      valid,
      reason: valid
        ? "V0.7候选计数完成，待人工验证"
        : "视频质量或有效事件数量不足",
      count: valid ? events.length : null,
      candidate_count_standard: events.length,
      rate_hz: valid ? events.length / duration : null,
      mean_interval_ms: valid
        ? intervals.reduce((a, b) => a + b, 0) /
          intervals.length
        : null,
      interval_cv_pct: valid
        ? intervalCV7(intervals)
        : null,
      events
    },
    raw_frames: frames,
    v07_detection: {
      algorithm: "median3_adaptive_hysteresis",
      low_threshold: result.low,
      high_threshold: result.high,
      distance_range: result.range,
      longest_detected_frame_gap_s: longestGap
    }
  };
}

function sendToV06Analyzer7(record) {
  // 复用 V0.6 已经存在的全局 analyze/render 函数。
  if (typeof analyze !== "function" ||
      typeof render !== "function") {
    throw new Error("V0.6 分析函数没有正确加载");
  }

  records = [record];
  analyses = [analyze(record)];

  if (analyses[0]) {
    analyses[0].source_version = "0.7-direct-video";
  }

  const select = document.getElementById("record");
  select.replaceChildren();

  const option = document.createElement("option");
  option.value = "0";
  option.textContent =
    record.file_name + "｜" + record.side +
    "｜" + (analyses[0].valid ? "有效" : "需复核");

  select.appendChild(option);

  document.getElementById("status").textContent =
    "V0.7视频识别完成，已自动进入运动学分析。";

  render();

  document.getElementById("results").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

v7("v07Run").addEventListener("click", async () => {
  const file = v7("v07File").files[0];

  if (!file) {
    setStatus7("请先选择一个 MP4 或 WebM 视频文件。");
    return;
  }

  canceled7 = false;
  latestRecord7 = null;
  v7("v07Run").disabled = true;
  v7("v07Cancel").disabled = false;
  v7("v07Export").disabled = true;

  try {
    await loadMetadata7(file);
    video7.pause();

    const fps = Number(v7("v07Fps").value);
    const duration = Math.min(video7.duration, 60);

    if (!video7.videoWidth || !video7.videoHeight) {
      throw new Error("视频宽高无效");
    }

    const width = Math.min(video7.videoWidth, 640);

    canvas7.width = width;
    canvas7.height = Math.round(
      width * video7.videoHeight / video7.videoWidth
    );

    const model = await initModel7();

    const total = Math.floor(duration * fps);
    if (total < 15) {
      throw new Error("视频过短，无法进行可靠分析");
    }

    const frames = [];
    let detected = 0;

    // 同一 MediaPipe 实例可能分析多个视频，
    // 推理时间戳必须保持严格递增。
    const baseTimestamp = Math.max(
      performance.now(),
      lastModelTimestamp7 + 1000
    );

    for (let i = 0; i < total; i++) {
      if (canceled7) {
        throw new Error("已取消本次视频分析");
      }

      const t = Math.min(
        (i + 0.5) / fps,
        duration - 0.001
      );

      await seekVideo7(t);

      ctx7.drawImage(
        video7,
        0, 0,
        canvas7.width,
        canvas7.height
      );

      const modelTimestamp = baseTimestamp + i * 1000 / fps;
      const inference = model.detectForVideo(
        canvas7,
        modelTimestamp
      );

      lastModelTimestamp7 = modelTimestamp;

      const landmarks = inference.landmarks?.[0];
      const sample = extractDistance7(landmarks, t);

      if (sample) {
        frames.push(sample);
        detected++;
      }

      if (i % 5 === 0 || i === total - 1) {
        const progress = ((i + 1) / total * 100);
        v7("v07Progress").style.width =
          progress.toFixed(1) + "%";

        setStatus7(
          "正在分析视频：" + (i + 1) + "/" + total +
          " 个采样点；关键点检出 " + detected + " 次"
        );

        await pauseUI7();
      }
    }

    const record = makeRecord7(
      file, fps, duration, frames, detected, total
    );

    latestRecord7 = record;
    v7("v07Export").disabled = false;

    sendToV06Analyzer7(record);

    setStatus7(
      "分析完成。手部检出率 " +
      (record.detected_fraction * 100).toFixed(1) +
      "%；候选对合事件 " +
      record.metrics.events.length +
      " 次。请人工复核计数。"
    );

  } catch (err) {
    setStatus7(
      "分析未完成：" + (err?.message || String(err))
    );
  } finally {
    v7("v07Run").disabled = false;
    v7("v07Cancel").disabled = true;
  }
});

v7("v07Cancel").addEventListener("click", () => {
  canceled7 = true;
  setStatus7("正在取消本次分析……");
});

v7("v07Export").addEventListener("click", () => {
  if (!latestRecord7) return;

  const payload = {
    version: "0.7",
    exported_at: new Date().toISOString(),
    records: [latestRecord7],
    enhanced_analysis: analyses[0] || null
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download =
    (latestRecord7.subject_id || "TEST") +
    "_V07_full.json";

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
});

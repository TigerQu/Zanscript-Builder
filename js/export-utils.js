// Zantiks MWP Script Builder - Syntax highlighting for the code preview and the offline ZIP builder
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 7. Syntax Highlighting (Read-only Preview)
// ---------------------------------------------------------------------------
function highlightZanscript(code) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return code.split("\n").map(line => {
    let commentPos = -1;
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inStr = !inStr;
      else if (line[i] === "#" && !inStr) {
        commentPos = i;
        break;
      }
    }
    const codePart = commentPos >= 0 ? line.slice(0, commentPos) : line;
    const commentPart = commentPos >= 0 ? line.slice(commentPos) : "";

    let html = esc(codePart)
      .replace(/"([^"]*)"/g, '<span class="zs-str">"$1"</span>')
      .replace(/\b(ACTION|COMPLETE|DEFINE|IF|ELSEIF|ELSE|ENDIF|WHILE|ENDWHILE|INCLUDE)\b/g, '<span class="zs-kw">$1</span>')
      .replace(/\b(INVOKE|SET|WAIT|LOAD|AUTOREFERENCE|LOGCREATE|LOGAPPEND|LOGRUN|LOGDATA|LOGFILE|VIDEO|VIDEOSKIP|VIDEOSTOP|ZCOMMAND|LIGHTS|Calibration|ResetDrawing|ShapeType|ShapeDraw|SaveDrawing|TargetMarker)\b/g, '<span class="zs-cmd">$1</span>')
      .replace(/(@\w+)/g, '<span class="zs-var">$1</span>');

    if (commentPart) {
      html += '<span class="zs-comment">' + esc(commentPart) + "</span>";
    }
    return html;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// 8. Offline Pure-JS ZIP Builder (STORE method + IEEE CRC32)
// ---------------------------------------------------------------------------
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >> 1) & 0x1F);
  const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = encoder.encode(f.content);
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    localParts.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    centralParts.push(central);
    offset += local.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

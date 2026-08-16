/**
 * يتأكد أن ملف .env موجود وفيه ADMIN_TOKEN
 * يُستدعى من start-calc.bat قبل تشغيل السيرفر
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
const DEFAULT_TOKEN = "123456";

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function hasAdminToken(content) {
  const m = content.match(/^\s*ADMIN_TOKEN\s*=\s*(.*)$/m);
  if (!m) return false;
  const value = String(m[1] || "")
    .replace(/[\r\n]/g, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  return Boolean(value);
}

let content = readEnv(envPath);
if (!content) {
  if (fs.existsSync(examplePath)) {
    content = readEnv(examplePath);
  } else {
    content = `PORT=5055\nINTERAKT_API_KEY=\nWEBHOOK_SECRET=\n`;
  }
}

if (!hasAdminToken(content)) {
  if (!content.endsWith("\n")) content += "\n";
  content += `ADMIN_TOKEN=${DEFAULT_TOKEN}\n`;
  fs.writeFileSync(envPath, content, "utf8");
  console.log(`[ensure-env] تم ضبط ADMIN_TOKEN=${DEFAULT_TOKEN}`);
} else if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, content, "utf8");
  console.log("[ensure-env] تم إنشاء ملف .env");
} else {
  console.log("[ensure-env] ملف .env جاهز");
}

/**
 * تحويل الأرقام العربية/الفارسية إلى إنجليزية
 * مثال: ٨٠٠٠ → 8000 ، ۴۰۰۰ → 4000
 */
function normalizeDigits(text) {
  return String(text ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

module.exports = { normalizeDigits };

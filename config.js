/**
 * =============================================================================
 * CONFIG — المصدر الوحيد لتعديل الرسائل / الشروط / الحسبات / الأرقام
 * =============================================================================
 * عدّل هذا الملف فقط لتغيير سلوك العرض (النصوص والأرقام والحدود).
 * منطق الخطوات والتدفقات يبقى في lib/handlers.js دون تغيير ترتيب الأسئلة.
 *
 * ملاحظات مستقبلية (مذكورة للتوسع):
 * - يمكن نقل sessions إلى Redis/DB عند التشغيل على VPS متعدد العمليات.
 * - يمكن ربط contact.phone بمتغير بيئة process.env.CONTACT_PHONE
 * =============================================================================
 */

module.exports = {
  // ---------------------------------------------------------------------------
  // عام
  // ---------------------------------------------------------------------------
  brand: {
    name: "رائد الحربي",
    contactPhone: "0501812339",
    contactHint: "من طرف رائد الحربي",
    /** أرقام المساعدين — خيار «رقم المساعد» في القائمة */
    assistants: [
      { name: "ماجد", phone: "0507009290" },
    ],
    /** عدّل نصوص الخيارات 2 و 4 و 5 من هنا */
    debtPurchaseInfo: `لطلب شراء المديونية فضلاً تواصل معنا على الرقم:
0501812339

وأرسل:
من طرف رائد الحربي — شراء مديونية`,
    workingHours: `ساعات ووقت الدوام الرسمي:

من الأحد إلى الخميس
9:00 صباحاً — 5:00 مساءً`,
    locationInfo: `موقعنا:

معرض السديري للسيارات

للتواصل مع عبدالرحمن:
0595243553`,
  },

  // ---------------------------------------------------------------------------
  // نوع العمل — التمويل الشخصي الجديد (نسب الفائدة %)
  // شراء المديونية: debtPurchase.interestRate (12% للجميع)
  // ---------------------------------------------------------------------------
  jobCategories: {
    military: { label: "عسكري", interestRate: 18.5 }, // 18.50% — تمويل شخصي جديد
    civilian: { label: "مدني", interestRate: 13 }, // 13% — حكومي
    private: { label: "قطاع خاص", interestRate: 15.5 }, // 15.50%
    retired: { label: "متقاعد", interestRate: 13 }, // 13%
  },

  // ---------------------------------------------------------------------------
  // حدود الشروط (قبول / رفض)
  // ---------------------------------------------------------------------------
  limits: {
    /** احتياط — يُستخدم إن لم يُحدد قطاع العميل */
    minSalary: 4000,
    /** أقل راتب للتمويل الشخصي العادي وشراء المديونية — عسكري 10,000 */
    minSalaryByCategory: {
      military: 10000,
      civilian: 4000,
      private: 4000,
      retired: 4000,
    },
    /** أقل مبلغ تقديري للقبول في المسار الشخصي */
    minEstimatedAmount: 15000,
    /** حد راتب مسار التمويل العقاري */
    propertyMinSalary: 7000,
    /** حد إيقاف الخدمات/التعثرات (يُسأل عنه نعم/لا وليس رقماً مباشرة) */
    propertyMaxDebtLabel: "350 ألف",
    /** عقاري + شخصي: أقل راتب (عسكري من 7,000 إذا لا يوجد عقاري) */
    comboMinSalary: 7000,
    /** نسبة التزامات من الراتب تُعتبر مرتفعة (مثال 0.25 = 25%) */
    civilianHighCommitmentsRatio: 0.25,
  },

  /**
   * مسار التمويل الشخصي (خيار 1) — مرجع لكل قطاع
   * التنفيذ: lib/handlers.js + lib/calculations.js
   */
  personalFinancingPath: {
    /** خطوات مشتركة بعد اختيار «تمويل شخصي» */
    steps: [
      "job_type",
      "salary",
      "real_estate",
      "commitments",
      "personal_amount_offer",
      "lower_amount_choice",
      "application_method",
    ],
    military: {
      minEntrySalary: 7000,
      minPersonalSalary: 10000,
      remoteAllowanceIfGrossFrom: 10000,
      noPropertyBelowPersonalMin: "property_combo_only",
      withPropertyBelowPersonalMin: "reject",
      atOrAbovePersonalMin: "standard",
    },
    civilian: {
      minEntrySalary: 4000,
      flow: "standard",
      comboFallback:
        "no_property + salary >= 7000 + amount < 15000",
    },
    retired: {
      sameAs: "civilian",
      showsAgeNotice: true,
    },
  },

  /** خيار عقاري + شخصي (عسكري ومدني) — مثال إجمالي مليون */
  comboPackage: {
    totalExample: 1000000,
    propertyAmount: 400000,
    personalAmount: 600000,
    minSalary: 7000,
  },

  /** أمثلة مبالغ التمويل من القائمة الرئيسية (بدون حسبة) */
  amountExamples: {
    min: 10000,
    max: 150000,
    /** بعد 10/15/20 ألف تكمل القائمة من 25 ألف بهذه الخطوة */
    step: 5000,
  },

  /**
   * مسار شراء المديونية (خيار 2) — مرجع لكل قطاع
   * التنفيذ: lib/handlers.js + lib/debt-purchase.js
   */
  debtPurchasePath: {
    steps: [
      "job_type",
      "salary",
      "real_estate",
      "commitments",
      "debt_purchase_amount",
      "debt_continue",
    ],
    interestRatePercent: 12,
    surplusMaxRatioOfDebt: 0.5,
    military: {
      minEntrySalary: 7000,
      belowPersonalMinNoProperty: "property_combo_only",
      belowPersonalMinWithProperty: "reject",
      atOrAbovePersonalMin: "debt_amount_offer",
      remoteAllowanceIfGrossFrom: 10000,
      comboDeclined: "apology_close",
    },
    civilian: {
      minEntrySalary: 4000,
      noPropertyMinSalaryForCombo: 7000,
      comboAtCommitmentsIfNoProperty: true,
      comboDeclined: "continue_debt_amount",
    },
    retired: { sameAs: "civilian" },
  },

  /** مسار شراء المديونية */
  debtPurchase: {
    /** فائدة سنوية على إجمالي (مديونية + فائض) — جميع القطاعات */
    interestRate: 12,
    /**
     * الفائض = أعلى مبلغ متاح من نسبة الاستقطاع − مبلغ شراء المديونية
     * (أعلى مبلغ يُحسب من المتبقي الشهري بمعادلة القسط + فائدة القطاع الشخصية)
     */
    letterCompanyExample: "إمكان",
  },

  // ---------------------------------------------------------------------------
  // نسب ومعادلة الحسبة (المسار الشخصي — خطوة الالتزامات)
  // المتاح الشهري = (الدخل × ratio) − الالتزامات
  // أعلى مبلغ = المتاح / (1/60 + الفائدة/12)  ← حتى لا يتجاوز القسط المتاح
  // divisor القديم احتياط فقط إن ما توفرت نسبة الفائدة
  // ---------------------------------------------------------------------------
  calculation: {
    ratios: {
      supported: 0.65,
      unsupported: 0.55,
      none: 0.45,
    },
    multiplier: 60,
    divisor: 1.725,
  },

  /** بعد الحسبة: تقريب المبلغ، الأقساط، التقديم الإلكتروني */
  financing: {
    /**
     * تقريب مبلغ العرض (حساب صحيح بدون كسور):
     * - 27,826 → 27,000 (باقي الآلاف 800–899)
     * - 28,923 → 28,900 | 10,330 → 10,300 (باقي الآلاف غير ذلك → لمئة)
     */
    roundToHundreds: 100,
    roundThousandsRemainderMin: 800,
    roundThousandsRemainderMax: 900,
    /** مبالغ كبيرة جداً: للأسفل لأقرب 10,000 (100,335 → 100,000) */
    roundToTenThousandsMinAmount: 100000,
    roundToTenThousandsStep: 10000,
    /** خطوة خفض المبلغ عند طلب مبلغ أقل (40,000 → 35,000 → …) */
    lowerStep: 5000,
    /** أقل مبلغ في قائمة «مبلغ أقل» — 44,000 تعرض: 40,000 … 10,000 */
    minLowerAmount: 10000,
    /** مدة التمويل بالأشهر لحساب القسط (افتراضي إن ما اختار العميل) */
    loanTermMonths: 60,
    /** خيارات المدة التي يختار منها العميل (بالسنوات) — من الأطول للأقصر */
    loanTermOptionsYears: [5, 4, 3, 2, 1],
    /** أقصى مدة نرجع لها إذا المختار أقصر وما يسمح الاستقطاع */
    loanTermFallbackYears: 5,
    /**
     * معادلة القسط (تمويل شخصي جديد — جميع القطاعات):
     * قسط = (المبلغ ÷ 60) + (المبلغ × نسبة الفائدة ÷ 12)
     * أمثلة: 10,000 @ 13% → 275 | 150,000 @ 18.5% → 4,813
     */
    installmentFormula: "equalPrincipal",
    installmentFormulaByCategory: {
      military: "equalPrincipal",
      civilian: "equalPrincipal",
      private: "equalPrincipal",
      retired: "equalPrincipal",
    },
    /** قسط التمويل العقاري القديم — يُخصم تلقائياً ولا يُطلب من العميل إدخاله */
    oldMortgageInstallment: 1667,
    /** شراء المديونية */
    portalUrl: "https://portal.sfco.com.sa/?DSA=SF1888",
    /** التمويل الشخصي — رابط التقديم الإلكتروني */
    personalPortalUrl: "https://portal.sfco.com.sa/?DSA=SF1695",
    /** رمز الموظف في التقديم الإلكتروني */
    personalEmployeeCode: "SF1695",
    employeeName: "عبدالرحمن",
    employeePhone: "0507009290",
    /** التمويل الشخصي — تقديم إلكتروني واستفسارات المسار الشخصي */
    personalAgentName: "عبدالرحمن",
    personalAgentPhone: "0595243553",
    /** شراء المديونية — بعد موافقة العميل على الإكمال */
    debtPurchaseAgentName: "ماجد",
    debtPurchaseAgentPhone: "0507009290",
    /** زيارة الفرع — بعد اختيار التقديم بالفرع */
    branchEmployeeName: "ماجد",
    branchEmployeePhone: "0507009290",
    /** باقة عقاري + شخصي — عند قبول العرض والتواصل */
    propertyComboAgentName: "أبو شايع",
    propertyComboAgentPhone: "0501812339",
    propertyComboContactFooter: "من طرف رائد الحربي\nربي يسر أمرك",
    /** إيقاف الخدمات — المندوب عند رغبة العميل بالتواصل */
    serviceStopAgentName: "أبو شايع",
    serviceStopAgentPhone: "0501812339",
    serviceStopContactHint: "من طرف رائد الحربي",
  },

  // ---------------------------------------------------------------------------
  // أوامر المالك — stop / start (من حسابك فقط، رسائل صادرة)
  // ---------------------------------------------------------------------------
  botControl: {
    stopCommands: ["stop", "ايقاف", "إيقاف", "توقف"],
    startCommands: ["start", "استئناف", "تشغيل"],
    stopAllCommands: [
      "stop all",
      "stopall",
      "ايقاف الكل",
      "إيقاف الكل",
      "توقف الكل",
    ],
    startAllCommands: [
      "start all",
      "startall",
      "استئناف الكل",
      "تشغيل الكل",
    ],
    chatPausedReply:
      "تم إيقاف الرد الآلي لهذا العميل فقط.\n\nباقي العملاء ما زال الرد الآلي يعمل لهم.",
    chatResumedReply: "تم استئناف الرد الآلي لهذا العميل.",
    pausedReply: "تم إيقاف الرد الآلي على جميع العملاء.",
    resumedReply:
      "تم استئناف الرد الآلي على جميع العملاء.\n\n(شمل المحادثات التي أوقفت بخيار 6)",
  },

  // ---------------------------------------------------------------------------
  // إعدادات البوت والجلسات
  // ---------------------------------------------------------------------------
  session: {
    /** تأخير بين رسائل نفس العميل لتقليل السبام والردود المتكررة */
    spamDelayMs: 1200,
    /** كلمات إعادة ضبط الجلسة / تصفير البيانات من منتصف المسار */
    resetKeywords: [
      "reset",
      "إعادة",
      "اعادة",
      "من جديد",
      "ابدأ من جديد",
      "ابدا من جديد",
      "إعادة من جديد",
      "اعادة من جديد",
      "ابدأ من الاول",
      "ابدا من الاول",
      "إعادة من الأول",
      "اعادة من الاول",
    ],
    /** كلمات إعادة بدء المحادثة أثناء جلسة نشطة */
    restartKeywords: ["ابدأ", "مرحبا", "السلام عليكم", "سلام", "هلا"],
    /**
     * بعد إرسال الرابط أو إتمام التقديم — لا تُعاد القائمة إلا بعد هذا العدد
     * من رسائل العميل (كلمات «ابدأ» و«reset» تبدّل فوراً).
     */
    postCloseMenuThreshold: 5,
    /**
     * تنظيف ذاكرة lastMessageTime للمستخدمين غير النشطين (بالساعات).
     * لا يغيّر تجربة المستخدم — يمنع تراكم الذاكرة على VPS طويل الأمد.
     */
    rateLimitCleanupHours: 24,
  },

  /** رسالة متابعة التقديم الإلكتروني — تُرسل من لوحة التحكم */
  followUp: {
    electronicMessage: `السلام عليكم
هل تم تقديم الطلب
في حال تم التقديم ارسل رقم الطلب`,
  },

  /**
   * إعدادات الإرسال الصادر من اللوحة (متابعة جماعية)
   * أرقام محافظة لتقليل خطر حظر واتساب عند الإرسال الجماعي.
   */
  outbound: {
    /** التأخير الافتراضي بين كل رسالة */
    delayMs: 10000,
    /** أقل تأخير مسموح به من الواجهة/الـ API */
    minDelayMs: 8000,
    /** أقصى عدد رسائل في دفعة واحدة */
    maxBatchSize: 30,
    /** سقف يومي لرسائل المتابعة الجماعية */
    dailyLimit: 80,
    /** تخطّي من أُرسلت له متابعة خلال هذه الساعات */
    skipIfFollowedUpWithinHours: 20,
    pollMs: 2500,
  },

  // ---------------------------------------------------------------------------
  // Puppeteer / WhatsApp Web
  // ---------------------------------------------------------------------------
  puppeteer: {
  /** false = تفتح نافذة Chrome ويظهر QR داخل واتساب ويب | true = مخفي (QR من اللوحة فقط) */
  headless: false,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,720",
    "--start-maximized",
  ],
},

  // ---------------------------------------------------------------------------
  // الرسائل — كل نص يظهر للعميل
  // ---------------------------------------------------------------------------
  messages: {
    readyLog: "البوت جاهز ويستقبل رسائل واتساب",
    qrLog: "امسح QR من واتساب:",
    nonText:
      "الرد على الأسئلة يكون بالكتابة (اكتب رقم الخيار أو نص الإجابة).",

    start: `مرحبا معاك رائد الحربي.

مانوع استفسارك؟

1- تمويل شخصي
2- شراء مديونية
3- مبالغ التمويل
4- عليك إيقاف خدمات وتبي الحل
5- ساعات ووقت الدوام الرسمي
6- موقعنا
7- رقم المساعد`,

    pauseChatAutoReply: `تم إيقاف الرد الآلي على هذه المحادثة فقط.

لن يصلك رد تلقائي هنا بعد الآن.`,

    invalidInquiryType: `الرجاء الرد على السؤال بالشكل الصحيح.

اكتب رقم الخيار أو نص الإجابة:

1- تمويل شخصي
2- شراء مديونية
3- مبالغ التمويل
4- عليك إيقاف خدمات وتبي الحل
5- ساعات ووقت الدوام الرسمي
6- موقعنا
7- رقم المساعد`,

    inquiryMenuFooter: `

للقائمة الرئيسية اكتب رقم الخيار أو: مرحبا`,

    jobType: `أي قطاع؟

اكتب رقم الخيار أو نص الإجابة:

1- عسكري
2- مدني
3- متقاعد`,

    invalidJobType: `الرجاء الرد على السؤال بالشكل الصحيح.

أي قطاع؟

1- عسكري
2- مدني
3- متقاعد`,

    remoteAllowanceCheck: `هل لديك بدل مناطق نائية؟

(يُخصم من راتبك الأساسي قبل الحسبة)

1- نعم
2- لا`,

    invalidRemoteAllowanceCheck: `الرجاء الرد على السؤال بالشكل الصحيح.

هل لديك بدل مناطق نائية؟

(يُخصم من راتبك الأساسي قبل الحسبة)

1- نعم
2- لا`,

    remoteAllowanceAmount: `أرسل قيمة بدل المناطق النائية بالأرقام فقط.

مثال:
2000`,

    invalidRemoteAllowanceAmount: `الرجاء كتابة قيمة البدل بالأرقام فقط.

مثال:
2000`,

    invalidPropertyCombo: `الرجاء الرد على السؤال بالشكل الصحيح.

1- نعم
2- لا`,

    propertyComboDeclinedDebt: `حسناً، نتابع إجراءات شراء المديونية حسب بياناتك (بدون باقة عقاري + شخصي).`,

    /** عند رفض عرض عقاري + شخصي (تمويل شخصي) */
    propertyComboDeclinedApology: `حسناً، نعتذر منك ونأسف على عدم خدمتك.`,

    propertyComboInterest: `هل ترغب بحلول تمويلية أخرى؟`,

    /**
     * رسالة منفصلة بعد نتيجة التمويل الشخصي (وأبعد اختيار مبلغ):
     * تسجيل المبلغ المرغوب + رمز الموظف + إرسال رقم الطلب
     */
    personalApplyFollowUp: (employeeCode, portalUrl) => {
      const code = employeeCode || "SF1695";
      const url =
        portalUrl || "https://portal.sfco.com.sa/?DSA=SF1695";
      return `سجل مبلغ التمويل المرغوب فيه
واكتب رمز الموظف ${code} بالتقديم لمتابعة الطلب
وارسلي رقم الطلب

${url}`;
    },

    serviceStopQualify: `هل راتبك لا يقل عن 7000 ريال
وما عليك عقاري؟`,

    serviceStopNotQualified: `بالتوفيق وحياك الله`,

    serviceStopAgentDeclined: `بالتوفيق وحياك الله`,

    realEstate: `هل لديك تمويل عقاري؟

اكتب رقم الخيار أو نص الإجابة:

1- عقاري مدعوم
2- عقاري غير مدعوم
3- لا يوجد عقاري
4- تمويل عقاري قديم قسطه 1667`,

    invalidRealEstate: `الرجاء الرد على السؤال بالشكل الصحيح.

هل لديك تمويل عقاري؟

اكتب رقم الخيار أو نص الإجابة:

1- عقاري مدعوم
2- عقاري غير مدعوم
3- لا يوجد عقاري
4- تمويل عقاري قديم قسطه 1667`,

    commitmentsWithOldMortgage: `أرسل إجمالي الالتزامات الشهرية بالأرقام فقط.

تنبيه: تم خصم قسط التمويل العقاري القديم (1667 ريال) مسبقاً — لا تدخله ضمن الالتزامات ولا تخصمه مرة أخرى.

مثال:
2500`,

    invalidCommitmentsWithOldMortgage: `الرجاء كتابة الالتزامات بالأرقام فقط.

تذكير: قسط 1667 ريال للتمويل العقاري القديم مخصوم مسبقاً — أرسل باقي الالتزامات فقط.

مثال:
2500`,

    supportAmount: `أرسل قيمة الدعم العقاري الشهري بالأرقام فقط.

مثال:
1000`,

    invalidSupportAmount: `الرجاء كتابة قيمة الدعم العقاري بالأرقام فقط.

مثال:
1000`,

    retiredAgeNotice: `تم اختيار: متقاعد

مع العلم: العمر المقبول لدينا 60 سنة.`,

    salaryCivilian: `أرسل راتبك الشهري بالأرقام فقط.

مثال:
4000`,

    salaryMilitary: `أرسل راتبك الشهري بالأرقام فقط.

مثال:
10000`,

    invalidSalaryCivilian: `الرجاء كتابة الراتب بالأرقام فقط.

مثال:
4000`,

    invalidSalaryMilitary: `الرجاء كتابة الراتب بالأرقام فقط.

مثال:
10000`,

    commitments: `أرسل إجمالي الالتزامات الشهرية بالأرقام فقط.

مثال:
2500`,

    commitmentsDebtPurchase: `أرسل إجمالي الالتزامات الشهرية بالأرقام فقط
(جميع الأقساط عندك بدون قسط الشركة التي نشتري مديونيتها).

مثال:
3500`,

    invalidCommitmentsDebtPurchase: `الرجاء كتابة إجمالي الالتزامات بالأرقام فقط
(جميع الأقساط عندك بدون قسط الشركة التي نشتري مديونيتها).

مثال:
3500`,

    invalidCommitments: `الرجاء كتابة الالتزامات بالأرقام فقط.

مثال:
2500`,

    propertySalary: `هل راتبك الشهري أكثر من 7000 ريال؟

اكتب رقم الخيار أو نص الإجابة:

1- نعم
2- لا`,

    invalidPropertySalary: `الرجاء الرد على السؤال بالشكل الصحيح.

هل راتبك الشهري أكثر من 7000 ريال؟

اكتب رقم الخيار أو نص الإجابة:

1- نعم
2- لا`,

    debtOver: `هل إيقاف الخدمات أو التعثرات تتجاوز 350 ألف ريال؟

اكتب رقم الخيار أو نص الإجابة:

1- نعم
2- لا`,

    invalidDebtOver: `الرجاء الرد على السؤال بالشكل الصحيح.

هل إيقاف الخدمات أو التعثرات تتجاوز 350 ألف ريال؟

اكتب رقم الخيار أو نص الإجابة:

1- نعم
2- لا`,

    rejectRetryFooter: `ملاحظة:
إذا كنت قد أدخلت البيانات بشكل خاطئ وترغب بإعادة المحاولة، أرسل الرقم:
1

تنبيه:
إعادة المحاولة متاحة مرة واحدة فقط.`,

    lowerAmountQuestion: `هل تبي مبلغ أقل؟

1- نعم
2- لا`,

    invalidLowerAmount: `الرجاء الرد على السؤال بالشكل الصحيح.

هل ترغب بمبلغ أقل؟

1- نعم
2- لا`,

    applicationMethod: `هل ترغب بالتقديم؟

1- تقديم إلكتروني
2- زيارة الفرع`,

    invalidApplicationMethod: `الرجاء الرد على السؤال بالشكل الصحيح.

هل ترغب بالتقديم؟

1- تقديم إلكتروني
2- زيارة الفرع`,

    invalidLowerAmountPick: `الرجاء اختيار رقم من القائمة أعلاه.`,

    orderNumberRecorded: `تم استلام رقم الطلب
سيتم الرد في أقرب وقت ممكن 
لمتابعة الطلب  ارسل رقم الطلب إلى 
 عبدالرحمن 
0595243553`,

    contactEmployeeQuestion: `هل ترغب بالتواصل مع الموظف؟

اكتب رقم الخيار أو نص الإجابة:

1- نعم
2- لا`,

    invalidContactEmployee: `الرجاء الرد على السؤال بالشكل الصحيح.

هل ترغب بالتواصل مع الموظف؟

1- نعم
2- لا`,

    debtPurchaseRules: `تنويه بخصوص شراء المديونية:

نشتري مديونية الشركات فقط مثل: إمكان، النايفات، اليسر
ونشتري مديونية واحدة فقط`,

    debtPurchaseAmount: `كم مبلغ شراء المديونية المطلوب؟

أرسل المبلغ بالأرقام فقط.

مثال:
20000`,

    invalidDebtPurchaseAmount: `الرجاء كتابة مبلغ شراء المديونية بالأرقام فقط.

مثال:
20000`,

    debtContinueQuestion: `هل تبي تكمل إجراءات شراء المديونية؟`,

    invalidDebtContinue: `هل تبي تكمل إجراءات شراء المديونية؟`,

    debtDeclined: "شكراً لتواصلك. إذا رغبت لاحقاً اكتب: مرحبا",

  },

  /**
   * قوالب رسائل ديناميكية (تستخدم brand من الأعلى)
   * يتم استدعاؤها عبر lib/messages.js
   */
  templates: {
    assistantContact: (name, phone) =>
      `رقم المساعد — ${name}:
${phone}

رائد الحربي`,

    assistantContacts: (assistants = []) => {
      const lines = (assistants || [])
        .filter((a) => a && a.name && a.phone)
        .map((a) => `رقم المساعد — ${a.name}:\n${a.phone}`);
      if (!lines.length) {
        return `رقم المساعد — رائد الحربي:
0501812339`;
      }
      return lines.join("\n\n");
    },

    serviceStopWelcome: (
      totalFormatted,
      propertyFormatted,
      personalFormatted
    ) =>
      `شروط إيقاف الخدمات:

• أقل راتب شهري: 7000 ريال
• ما عليك عقاري
• شركة تسددلك جميع التزاماتك
• في شركة تستخرج لك مثال
${totalFormatted} ريال
${propertyFormatted} ريال عقاري
${personalFormatted} ريال شخصي
كل عميل حسب راتبه وحسب حسبة البنك له يعني 60% كاش

سنرسل لك رقم المندوب المختص الآن.`,

    serviceStopQualify: () =>
      `هل راتبك لا يقل عن 7000 ريال
وما عليك عقاري؟`,

    serviceStopOffer: (
      totalFormatted,
      propertyFormatted,
      personalFormatted
    ) =>
      `• شركة تسددلك جميع التزاماتك
• و تستخرج لك مثال
مليون
${propertyFormatted} ريال عقاري
${personalFormatted} ريال شخصي
كل عميل حسب راتبه وحسب حسب البنك له يعني 60% كاش

تبي ارسلك رقم المندوب؟`,

    serviceStopNotQualified: () => `بالتوفيق وحياك الله`,

    serviceStopAgentDeclined: () => `بالتوفيق وحياك الله`,

    personalAmountOffer: (amountFormatted, installmentFormatted) =>
      `قيمة التمويل:
${amountFormatted} ريال

القسط الشهري:
${installmentFormatted} ريال`,

    lowerAmountsNumberedList: (lines) =>
      `اختر المبلغ المناسب:\n\n${lines}`,

    selectedAmountDetail: (
      amountFormatted,
      totalFormatted,
      installmentFormatted
    ) =>
      `التمويل: ${amountFormatted} ريال
الإجمالي: ${totalFormatted} ريال
القسط: ${installmentFormatted} ريال`,

    personalRejectReason: (reasonKey) => {
      const fmt = (n) => Number(n).toLocaleString("en-US");
      const militaryMin =
        module.exports.limits.minSalaryByCategory.military;
      const civilianMin =
        module.exports.limits.minSalaryByCategory.civilian;
      const lines = {
        military_low_salary: `نعتذر منك الراتب أقل من المطلوب، الراتب المطلوب للعسكري من ${fmt(militaryMin)} ريال`,
        civilian_low_salary: `نعتذر منك الراتب أقل من المطلوب، راتب المدني من ${fmt(civilianMin)} ريال`,
        high_commitments: "نعتذر منك التزامك عالي",
        low_amount: "مستنفذ حد التمويل الشخصي نعتذر منك",
        low_amount_and_commitments: "نعتذر منك التزامك عالي",
      };
      return lines[reasonKey] || "";
    },

    propertyComboOffer: (
      totalFormatted,
      propertyFormatted,
      personalFormatted
    ) =>
      `حلول تمويل أخرى
في حال رغبتك بسداد جميع التزاماتك واستخراج
عرض التمويل العقاري + الشخصي

في شركة تستخرج لك بعد ماتسددلك
مثال ${totalFormatted} ريال
${propertyFormatted} ريال عقاري
${personalFormatted} ريال شخصي

يعني 60% كاش حسب حسبتك بالبنك

هل ترغب بهذا العرض؟`,

    propertyComboAgentDirect: (agentName, agentPhone, footer) =>
      `للتواصل مع المندوب ${agentName}:
${agentPhone}

${footer}`,

    debtPurchaseOffer: (
      debtFormatted,
      surplusFormatted,
      installmentFormatted
    ) =>
      `سداد المديونية: ${debtFormatted} ريال
الفائض الشخصي: ${surplusFormatted} ريال

القسط الشهري (على الإجمالي): ${installmentFormatted} ريال`,

    debtPurchaseComplete: (employeeName, employeePhone, portalUrl, letterCompany) =>
      `لإكمال طلب شراء المديونية:

تواصل مع الموظف ${employeeName}:
${employeePhone}

يرجى إحضار خطاب شراء مديونية (مثال: من شركة ${letterCompany})

رابط التقديم الإلكتروني:
${portalUrl}`,

    electronicApplication: (portalUrl, employeeName, employeePhone, salesCode) => {
      const code = String(salesCode || "SF1695").toLowerCase();
      return `تقديم إلكتروني

رابط التقديم:
${portalUrl}

*تنبيه: يرجى إضافة كود موظف المبيعات ${code} تجنباً لرفض الطلب*

بعد الانتهاء من التقديم أرسل لنا رقم الطلب (8 أرقام ويبدأ بـ 101).

في حال السداد المبكر:
نأخذ فوائد 3 شهور مقدماً، والباقي من الفوائد خصم بالكامل.

أي استفسار أو تفاصيل كلم الموظف المختص ${employeeName}
رقم التواصل: ${employeePhone}`;
    },

    employeeContact: (name, phone, contactLabel = "الموظف") =>
      `للتواصل مع ${contactLabel} ${name}:
${phone}

شاكرين تواصلكم.
رائد الحربي`,

    serviceStopAgentContact: (agentName, agentPhone, attribution) =>
      `للتواصل مع المندوب ${agentName}:
${agentPhone}
${attribution || "من طرف رائد الحربي"}`,

    serviceStopDeclined: () => "تشرفنا بك وبالتوفيق",

    serviceStopContactQuestion: () =>
      `هل تبي رقم المندوب؟

1- نعم
2- لا`,

    invalidServiceStopContact: () =>
      `الرجاء الرد بالشكل الصحيح.

هل تبي رقم المندوب؟

1- نعم
2- لا`,

    applicationCompleteNoEmployee:
      "شكراً لك. بالتوفيق في إجراءات التقديم.\n\nرائد الحربي",

    propertySuccess: (phone, hint) =>
      `أنت مؤهل مبدئيًا للاستكمال.

فضلاً تواصل عبر الرقم التالي:
${phone}

وأرسل الرسالة التالية:
${hint}

أو أرسل لقطة شاشة من هذه المحادثة لاستكمال الإجراءات.`,

    serviceStopQualified: (agentName, agentPhone, hint) =>
      `أنت مؤهل مبدئيًا لاستكمال إجراءات إيقاف الخدمات.

للتواصل مع المندوب ${agentName}:
${agentPhone}

عند التواصل أرسل:
${hint}

أو أرسل لقطة شاشة من هذه المحادثة.`,

    temporaryError:
      "حدث خطأ مؤقت. الرجاء كتابة reset لإعادة المحاولة.",
  },
};

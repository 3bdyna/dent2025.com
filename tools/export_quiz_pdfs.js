const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
}

function detectQuestionLanguage(q) {
    const explicit = String(q?.language || '').toLowerCase().trim();
    if (explicit === 'ar' || explicit === 'arabic' || explicit === 'العربية') return 'ar';
    if (explicit === 'en' || explicit === 'english') return 'en';

    const sample = [q?.question || '', q?.explanation || '', ...(Array.isArray(q?.options) ? q.options : [])].join(' ');
    const arabicCount = (sample.match(/[\u0600-\u06FF]/g) || []).length;
    const latinCount = (sample.match(/[A-Za-z]/g) || []).length;
    return arabicCount > latinCount ? 'ar' : 'en';
}

function stripOptionPrefix(value) {
    let text = String(value || '').trim();
    let prev = '';
    while (text !== prev) {
        prev = text;
        if (/^\d+\.\d+/.test(text)) break;
        text = text.replace(/^\s*[\([（{]\s*(?:[A-Za-z]|[0-9]{1,2}|[أإآابجدههـوزحطيكلمنسعفصقرشتثخﺬضظغ]|ح[A-Za-z]?)\s*[\)\]）}]:?\s*/u, '').trim();
        text = text.replace(/^\s*(?:[A-Za-z]|[0-9]{1,2}|[أإآابجدههـوزحطيكلمنسعفصقرشتثخﺬضظغ]|ح[A-Za-z]?)\s*(?:[\)\]）:\-–—]|\.(?!\d))\s*/u, '').trim();
    }
    return text;
}

function stripQuestionPrefix(value) {
    let text = String(value || '').trim();
    let prev = '';
    while (text !== prev) {
        prev = text;
        if (/^\d+\.\d+/.test(text)) break;
        text = text.replace(/^(?:(?:Q(?:uestion)?|س(?:ؤال)?)\s*\.?\s*\d+\s*(?:[:.)\-–—]\s*|\s+)|\(\d+\)\s*[:.)\-–—\s]*|\d+\s*(?:[:)\-–—]|\.(?!\d))\s*)/iu, '').trim();
    }
    return text;
}

function getCorrectOptionIndex(question, options) {
    if (!Array.isArray(options) || options.length === 0) return -1;
    if (question?.correctIndex !== null && question?.correctIndex !== undefined && question?.correctIndex !== '') {
        const explicitIndex = Number(question.correctIndex);
        if (Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < options.length) {
            return explicitIndex;
        }
    }
    const correct = String(question?.correctAnswer || '').trim();
    if (!correct) return -1;

    const exactIndex = options.findIndex(option => String(option).trim().toLowerCase() === correct.toLowerCase());
    if (exactIndex !== -1) return exactIndex;

    const cleanCorrect = stripOptionPrefix(correct).toLowerCase();
    const textIndex = options.findIndex(option => stripOptionPrefix(option).toLowerCase() === cleanCorrect);
    if (textIndex !== -1) return textIndex;

    const latinMatch = correct.match(/^([A-H])(?:\s*[.)\-:]*)?$/i);
    if (latinMatch) return latinMatch[1].toUpperCase().charCodeAt(0) - 65 < options.length
        ? latinMatch[1].toUpperCase().charCodeAt(0) - 65 : -1;

    const normalizedArabic = correct.replace(/[إأآ]/g, 'ا').replace(/[.)\-:\s]+$/u, '').trim();
    const arabicLetters = ['ا', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
    const arabicIndex = arabicLetters.indexOf(normalizedArabic);
    return arabicIndex >= 0 && arabicIndex < options.length ? arabicIndex : -1;
}

function estimateQuestionHeight(q, includeExplanations = true, isComfortable = false) {
    let h = isComfortable ? 28 : 24;
    const rawQuestion = String(q?.question || '').trim();
    const cleanQuestion = stripQuestionPrefix(rawQuestion);
    const qLen = cleanQuestion.length;
    const qLines = Math.max(1, Math.ceil(qLen / (isComfortable ? 46 : 52)));
    h += (qLines * (isComfortable ? 15 : 13)) + (isComfortable ? 4 : 2);

    const qType = q?.type || 'mcq';
    if (qType === 'card' || qType === 'short' || qType === 'info') {
        const rawAns = String(q?.answer || '');
        const textOnly = rawAns.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const brLines = (rawAns.match(/<br\s*\/?>/gi) || []).length;
        const liLines = (rawAns.match(/<li[\s>]/gi) || []).length;
        const nlLines = (rawAns.match(/\n/g) || []).length;
        const explicitLines = brLines + liLines + nlLines;
        const textWrapLines = Math.max(1, Math.ceil(textOnly.length / 48));
        const estimatedLines = Math.min(Math.max(explicitLines, textWrapLines), 16);
        h += 12 + (estimatedLines * (isComfortable ? 15 : 13));
    } else {
        const opts = Array.isArray(q?.options) ? q.options : [];
        opts.forEach(opt => {
            const cleanOpt = stripOptionPrefix(opt);
            const optLen = cleanOpt.length;
            const optLines = Math.max(1, Math.ceil(optLen / (isComfortable ? 42 : 46)));
            const baseH = isComfortable ? 24 : 21;
            const lineH = isComfortable ? 16 : 14;
            h += baseH + ((optLines - 1) * lineH);
        });
    }

    if (includeExplanations && q?.explanation) {
        const exp = String(q.explanation).trim();
        if (exp) {
            const expClean = exp.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const expLines = Math.max(1, Math.ceil(expClean.length / (isComfortable ? 46 : 50)));
            h += 8 + (expLines * (isComfortable ? 14 : 12));
        }
    }
    return h + (isComfortable ? 8 : 3);
}

function calculateSmartPages(questions, includeExplanations = true) {
    if (!Array.isArray(questions) || questions.length === 0) return [];
    const n = questions.length;
    const maxPerPage = includeExplanations ? 16 : 26;
    const estH = (q, isComfortable) => estimateQuestionHeight(q, includeExplanations, isComfortable);

    const pageFits = (sliceStart, sliceEnd, pIdx) => {
        const count = sliceEnd - sliceStart;
        if (count === 0) return false;
        if (count === 1) return true;
        if (count > maxPerPage) return false;
        const limit = (pIdx === 0) ? 910 : 930;
        const isComfortable = (count <= 8);
        let c1 = 0, c2 = 0;
        for (let i = sliceStart; i < sliceEnd; i++) {
            const h = estH(questions[i], isComfortable);
            if (c1 <= c2) c1 += h;
            else c2 += h;
        }
        return (c1 <= limit && c2 <= limit);
    };

    for (let P = 1; P <= n; P++) {
        const memo = new Map();
        const findPartition = (startIdx, pageIdx) => {
            const key = `${startIdx}:${pageIdx}`;
            if (memo.has(key)) return memo.get(key);
            const remPages = P - pageIdx;
            const remQs = n - startIdx;

            if (remPages === 1) {
                if (pageFits(startIdx, n, pageIdx)) {
                    const res = [remQs];
                    memo.set(key, res);
                    return res;
                }
                memo.set(key, null);
                return null;
            }

            const maxCandidate = Math.min(maxPerPage, remQs - remPages + 1);
            const candidates = [];
            for (let cnt = 1; cnt <= maxCandidate; cnt++) {
                if (pageFits(startIdx, startIdx + cnt, pageIdx)) {
                    candidates.push(cnt);
                }
            }
            const ideal = remQs / remPages;
            candidates.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));

            for (const cnt of candidates) {
                const sub = findPartition(startIdx + cnt, pageIdx + 1);
                if (sub !== null) {
                    const res = [cnt, ...sub];
                    memo.set(key, res);
                    return res;
                }
            }
            memo.set(key, null);
            return null;
        };

        const part = findPartition(0, 0);
        if (part !== null) {
            const pages = [];
            let cur = 0;
            for (const cnt of part) {
                pages.push(questions.slice(cur, cur + cnt));
                cur += cnt;
            }
            return pages;
        }
    }
    return [questions];
}

function renderQuizCardHtml(q, globalQIdx, includeExplanation) {
    const qType = q.type || 'mcq';
    const rawQuestion = String(q.question || '').trim();
    const cleanQuestion = stripQuestionPrefix(rawQuestion);
    const qText = escapeHtml(cleanQuestion);
    const chapter = escapeHtml(String(q.assignedChapter || '').trim());
    const isRtl = (detectQuestionLanguage(q) === 'ar');
    const rtlClass = isRtl ? ' is-rtl' : '';

    let typeLbl = 'MCQ';
    if (qType === 'tf') {
        typeLbl = isRtl ? 'صح / خطأ' : 'T / F';
    } else if (qType === 'card' || qType === 'short' || qType === 'info') {
        typeLbl = isRtl ? 'سؤال قصير' : 'Short Answer';
    }

    const chapHtml = chapter ? `<div class="quiz-q-chapter">${chapter}</div>` : '';
    const bodyLines = [`<div class="quiz-q-title${rtlClass}">${qText}</div>`];

    if (qType === 'mcq' || qType === 'tf') {
        const opts = Array.isArray(q.options) ? q.options : [];
        const cIdx = getCorrectOptionIndex(q, opts);
        bodyLines.push(`<div class="quiz-options-list${rtlClass}">`);
        opts.forEach((opt, oIdx) => {
            const isC = (oIdx === cIdx);
            const optLetter = String.fromCharCode(65 + oIdx);
            const rowCls = isC ? `quiz-opt-row is-correct${rtlClass}` : `quiz-opt-row${rtlClass}`;
            const cleanOptText = escapeHtml(stripOptionPrefix(opt));
            bodyLines.push(`
                <div class="${rowCls}">
                    <span class="quiz-opt-letter">${optLetter}.</span>
                    <span class="quiz-opt-text">${cleanOptText}</span>
                </div>
            `);
        });
        bodyLines.push('</div>');
    } else if (qType === 'card' || qType === 'short' || qType === 'info') {
        const ans = String(q.answer || '');
        const ansRend = /<[a-z][\s\S]*>/i.test(ans)
            ? ans
            : escapeHtml(ans).replace(/\\n|\r?\n/g, '<br>');
        const lbl = isRtl ? 'الإجابة النموذجية:' : 'Model Answer:';
        bodyLines.push(`
            <div class="quiz-short-answer-box${rtlClass}">
                <div class="quiz-short-answer-label">${lbl}</div>
                <div class="quiz-short-answer-content${rtlClass}">${ansRend}</div>
            </div>
        `);
    }

    const exp = String(q.explanation || '').trim();
    if (includeExplanation && exp) {
        const expLbl = isRtl ? 'الشرح:' : 'Explanation:';
        const expRend = /<[a-z][\s\S]*>/i.test(exp) ? exp : escapeHtml(exp);
        bodyLines.push(`
            <div class="quiz-explanation-box${rtlClass}">
                <strong>${expLbl}</strong> ${expRend}
            </div>
        `);
    }

    return `
        <div class="quiz-q-block">
            <div class="quiz-q-top-row">
                <div class="quiz-q-num-badge">
                    <span>Q${globalQIdx}</span>
                    <span class="quiz-type-badge">${typeLbl}</span>
                </div>
                ${chapHtml}
            </div>
            ${bodyLines.join('')}
        </div>
    `;
}

// Read CSS from quiz_app.html directly to ensure exact match
const quizAppContent = fs.readFileSync(path.join(__dirname, '../frontend-html box in wordpress astra/quiz_app.html'), 'utf-8');
const cssMatch = quizAppContent.match(/const DENT_QUIZ_EXPORT_CSS = `([\s\S]*?)`;/);
if (!cssMatch) {
    throw new Error('Could not extract DENT_QUIZ_EXPORT_CSS from quiz_app.html');
}
const DENT_QUIZ_EXPORT_CSS = cssMatch[1];

function generateExamBookletHtml(quizData, includeExplanations = true) {
    const quizName = escapeHtml(quizData.quiz_name || quizData.title || 'اختبار تجريبي');
    const subjectName = escapeHtml(quizData.subject_name || 'مادة دراسية');
    const allQuestions = Array.isArray(quizData.questions) ? quizData.questions : [];
    const qCount = allQuestions.length;
    const isDocRtl = (detectQuestionLanguage(allQuestions[0] || {}) === 'ar');

    const pages = calculateSmartPages(allQuestions, includeExplanations);
    const totalPages = pages.length;

    let globalQIdx = 1;
    const renderedPages = [];

    pages.forEach((pageQs, pIdx0) => {
        const pIdx = pIdx0 + 1;
        let testCol1 = 0;
        let testCol2 = 0;
        pageQs.forEach((q) => {
            const h = estimateQuestionHeight(q, includeExplanations, true);
            if (testCol1 <= testCol2) testCol1 += h;
            else testCol2 += h;
        });
        const pageLimit = (pIdx === 1) ? 910 : 930;
        const isComfortable = (Math.max(testCol1, testCol2) <= pageLimit);
        const densityClass = isComfortable ? ' density-comfortable' : ' density-compact';

        const col1Cards = [];
        const col2Cards = [];
        let col1H = 0;
        let col2H = 0;

        pageQs.forEach((q) => {
            const cardHtml = renderQuizCardHtml(q, globalQIdx, includeExplanations);
            globalQIdx++;
            const h = estimateQuestionHeight(q, includeExplanations, isComfortable);
            if (col1H <= col2H) {
                col1Cards.push(cardHtml);
                col1H += h;
            } else {
                col2Cards.push(cardHtml);
                col2H += h;
            }
        });

        const columnsHtml = `
            <div class="page-two-columns${densityClass}">
                <div class="col-half">${col1Cards.join('')}</div>
                <div class="col-half">${col2Cards.join('')}</div>
            </div>
        `;

        let headerHtml = '';
        const qCountLabel = isDocRtl ? `${qCount} أسئلة` : `${qCount} Questions`;
        const continueLabel = isDocRtl ? `تابع • ${qCountLabel}` : `Cont. • ${qCountLabel}`;
        const pageOfLabel = isDocRtl ? `صفحة ${pIdx} من ${totalPages}` : `Page ${pIdx} of ${totalPages}`;

        if (pIdx === 1) {
            headerHtml = `
                <div class="doc-header">
                    <div class="doc-titles">
                        <div class="doc-main-heading" dir="auto"><bdi>${quizName}</bdi></div>
                        <div class="doc-sub-heading" dir="auto"><bdi>${subjectName}</bdi></div>
                    </div>
                    <div class="doc-meta-badge">
                        <span class="period" dir="ltr">${qCountLabel}</span>
                    </div>
                </div>
            `;
        } else {
            headerHtml = `
                <div class="doc-header doc-header-compact">
                    <div class="doc-titles">
                        <div class="doc-compact-heading" dir="auto"><bdi>${quizName}</bdi></div>
                        <div class="doc-compact-sub" dir="auto"><bdi>${subjectName}</bdi></div>
                    </div>
                    <div class="doc-meta-badge">
                        <span class="period" dir="ltr">${continueLabel}</span>
                    </div>
                </div>
            `;
        }

        const docFooterBrand = 'dent2025.com';
        const footerHtml = `
            <div class="doc-footer">
                <span class="doc-footer-left">${docFooterBrand}</span>
                <span class="doc-footer-center">${pageOfLabel}</span>
                <span class="doc-footer-right">${docFooterBrand}</span>
            </div>
        `;

        renderedPages.push(`
            <div class="a4-page-sheet${densityClass}" id="quiz-page-${pIdx}" data-page="${pIdx}">
                <div class="page-inner-content">
                    ${headerHtml}
                    ${columnsHtml}
                </div>
                ${footerHtml}
            </div>
        `);
    });

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>${quizName}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
    ${DENT_QUIZ_EXPORT_CSS}
    @page { size: A4 portrait; margin: 0; }
    body { background: #121212 !important; margin: 0; padding: 0; }
    .a4-page-sheet { page-break-after: always; break-after: page; box-sizing: border-box; }
    .a4-page-sheet:last-child { page-break-after: avoid; break-after: avoid; }
    </style>
</head>
<body>
    ${renderedPages.join('\n')}
</body>
</html>`;
}

// Quizzes to process for Dentistry Year 3 Semester 1
const quizzes = [
    {
        file: 'quiz_patho_y3s1_mid_old.json',
        id: 'quiz_patho_y3s1_mid_old',
        outputName: '01_General_Pathology_Midterm_Past_Exams_(101_Questions).pdf',
        cleanTitle: 'General Pathology - تجميعات أسئلة السنوات السابقة (Midterm)',
        questionsCount: 101,
        subject: 'General Pathology │ علم الأمراض العام'
    },
    {
        file: 'quiz_operative_y3s1_cards.json',
        id: 'quiz_operative_y3s1_cards',
        outputName: '02_Pre-clinical_Operative_Dentistry_Quiz1_Past_Exams_(57_Questions).pdf',
        cleanTitle: 'Pre-clinical Operative Dentistry - تجميعات أسئلة السنوات السابقة (Quiz 1)',
        questionsCount: 57,
        subject: 'Pre-clinical Operative Dentistry │ اصحاح الأسنان ما قبل السريري'
    },
    {
        file: 'quiz_omr_y3s1_cards.json',
        id: 'quiz_omr_y3s1_cards',
        outputName: '03_Oral_and_Maxillofacial_Radiology_Quiz1_Past_Exams_(53_Questions).pdf',
        cleanTitle: 'Oral and Maxillofacial Radiology - تجميعات أسئلة السنوات السابقة (Quiz 1)',
        questionsCount: 53,
        subject: 'Oral and Maxillofacial Radiology │ أشعة الفم والوجه والفكين'
    },
    {
        file: 'quiz_prostho_y3s1_cards.json',
        id: 'quiz_prostho_y3s1_cards',
        outputName: '04_Pre-clinical_Removable_Prosthodontics_Quiz1_Past_Exams_(43_Questions).pdf',
        cleanTitle: 'Pre-clinical Removable Prosthodontics - تجميعات أسئلة السنوات السابقة (Quiz 1)',
        questionsCount: 43,
        subject: 'Pre-clinical Removable Prosthodontics │ الاستعاضة المتحركة ما قبل السريرية'
    },
    {
        file: 'quiz_biomater_y3s1_mid_old.json',
        id: 'quiz_biomater_y3s1_mid_old',
        outputName: '05_Advanced_Dental_Biomaterials_Midterm_Past_Exams_(37_Questions).pdf',
        cleanTitle: 'Advanced Dental Biomaterials - تجميعات أسئلة السنوات السابقة (Midterm)',
        questionsCount: 37,
        subject: 'Advanced Dental Biomaterials │ مواد طب الأسنان الحيوية المتقدمة'
    },
    {
        file: 'quiz_6ac485d34dfd3_9b5c.json',
        id: 'quiz_6ac485d34dfd3_9b5c',
        outputName: '06_Advanced_Dental_Biomaterials_Quiz1_Important_MCQs_(21_Questions).pdf',
        cleanTitle: 'Advanced Dental Biomaterials - تجميعات وأسئلة هامة من السلايدات (Quiz 1)',
        questionsCount: 21,
        subject: 'Advanced Dental Biomaterials │ مواد طب الأسنان الحيوية المتقدمة'
    },
    {
        file: 'quiz_dph_y3s1_mid_old.json',
        id: 'quiz_dph_y3s1_mid_old',
        outputName: '07_Dental_Public_Health_Midterm_Past_Exams_(25_Questions).pdf',
        cleanTitle: 'Dental Public Health - تجميعات أسئلة السنوات السابقة (Midterm)',
        questionsCount: 25,
        subject: 'Dental Public Health │ الصحة العامة للأسنان'
    },
    {
        file: 'quiz_6ac883921a561_c97f.json',
        id: 'quiz_6ac883921a561_c97f',
        outputName: '08_Oral_Diagnosis_Quiz1_This_Year_Questions_(5_Questions).pdf',
        cleanTitle: 'Oral Diagnosis - تجميعات أسئلة هذي السنة (Quiz 1)',
        questionsCount: 5,
        subject: 'Oral Diagnosis │ تشخيص الفم'
    },
    {
        file: 'quiz_6ae5b77350dd9_ac1f.json',
        id: 'quiz_6ae5b77350dd9_ac1f',
        outputName: '09_Oral_Diagnosis_Comprehensive_5_Lectures_(50_Questions).pdf',
        cleanTitle: 'Oral Diagnosis - Oral Diagnosis • 5 Lectures',
        questionsCount: 50,
        subject: 'Oral Diagnosis │ تشخيص الفم'
    },
    {
        file: 'quiz_6aaea8921eacb_1a7f.json',
        id: 'quiz_6aaea8921eacb_1a7f',
        outputName: '10_Pre-clinical_Operative_Dentistry_Comprehensive_4_Lectures_(21_Questions).pdf',
        cleanTitle: 'Pre-clinical Operative Dentistry - اختبار شامل (4 محاضرات)',
        questionsCount: 21,
        subject: 'Pre-clinical Operative Dentistry │ اصحاح الأسنان ما قبل السريري'
    },
    {
        file: 'quiz_micro_y3s1_mid_comprehensive.json',
        id: 'quiz_micro_y3s1_mid_comprehensive',
        outputName: '11_Oral_Microbiology_and_Immunology_Midterm_Comprehensive_Past_Exams_(65_Questions).pdf',
        cleanTitle: 'Oral Microbiology and Immunology - تجميعات الميد والاختبار الشامل (Oral Microbiology)',
        questionsCount: 65,
        subject: 'Oral Microbiology and Immunology │ علم الأحياء الدقيقة والمناعة الفموي'
    }
];

const outDir = path.join(__dirname, '../backup_exams_dentistry_y3s1');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log(`Starting PDF generation for ${quizzes.length} exams...`);

quizzes.forEach((item, index) => {
    const jsonPath = path.join(__dirname, '../quizzes_data', item.file);
    if (!fs.existsSync(jsonPath)) {
        console.warn(`File not found: ${jsonPath}`);
        return;
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const pdfPath = path.join(outDir, item.outputName);
    const html = generateExamBookletHtml(data, true);
    const tempHtmlPath = path.join(outDir, `temp_${index}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf-8');

    console.log(`[${index + 1}/${quizzes.length}] Rendering: ${item.outputName}...`);
    try {
        const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
        execSync(`"${chromePath}" --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${fileUrl}"`, { stdio: 'pipe' });
        console.log(`   -> Successfully generated ${item.outputName} (${fs.statSync(pdfPath).size} bytes)`);
    } catch (e) {
        console.error(`   -> Error generating PDF for ${item.outputName}:`, e.message);
    } finally {
        if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
    }
});

// Generate TXT file with links and names
let txtContent = `================================================================================
DENT2025.COM - DENTISTRY YEAR 3 SEMESTER 1 EXAMS & LEAKS BACKUP
كل روابط وأسماء اختبارات وتجميعات طب الأسنان - السنة الثالثة الفصل الأول
Target Backup Folder: https://drive.google.com/drive/u/0/folders/1ganLfL8l7v_M6LhDqRDQEEpO0kv6EYXp
Generated Date: 2026-11-02
================================================================================\n\n`;

quizzes.forEach((q, idx) => {
    const link = `https://dent2025.com/المقررات-والاختبارات/?quiz_id=${q.id}`;
    txtContent += `[${idx + 1}] ${q.cleanTitle}\n`;
    txtContent += `    Subject: ${q.subject}\n`;
    txtContent += `    Questions: ${q.questionsCount} Qs\n`;
    txtContent += `    Backup PDF File: ${q.outputName}\n`;
    txtContent += `    Direct Online Exam Link: ${link}\n\n`;
});

txtContent += `================================================================================
Direct Platform Portal: https://dent2025.com/المقررات-والاختبارات/
================================================================================\n`;

const txtPath = path.join(outDir, 'Dent2025_Dentistry_Y3S1_Exams_Backup_Links.txt');
fs.writeFileSync(txtPath, txtContent, 'utf-8');
console.log(`Successfully generated links text file: ${txtPath}`);

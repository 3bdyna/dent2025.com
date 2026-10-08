# Dent2025 - Current Main Page Design Specification & Redesign Handoff Document

> **Document Purpose**: This file provides a complete, granular architectural and visual specification of the **current Dent2025 homepage design**. Hand this document to any AI coding agent, UI/UX designer, or frontend engineer to redesign the site with full context of its existing layout, functionality, assets, and design system.

---

## 1. Executive Summary & Brand Identity

* **Website**: [Dent2025](https://dent2025.com/) — University Medical & Dental Academic Portal.
* **Target Audience**: University dental and medicine students (high-stress, mobile-heavy users needing fast, distraction-free access to daily schedules, course materials, and study tools).
* **Primary Language & Direction**: **Arabic (RTL)** with bilingual English labels.
* **Design Aesthetic**: Dark mode, glassmorphism, muted neon accent badges, rounded cards (14px–26px).
* **Standalone Mockup File**: [`current_main_page_mockup.html`](file:///c:/Users/3bdyna/MY%20PROJECTS/my%20website%20dent2025/current_main_page_mockup.html) (Open in browser to see the live layout offline).
* **Live Scraped Source**: [`main_page_live.html`](file:///c:/Users/3bdyna/MY%20PROJECTS/my%20website%20dent2025/main_page_live.html) (~429 KB complete WordPress rendered DOM).

---

## 2. Layout Wireframe & Information Hierarchy

```
+--------------------------------------------------------------------------+
|  [Sticky Top Pill]: 🎓 طب الأسنان | السنة 3 | الفصل 1  [تغيير المسار]     |
+--------------------------------------------------------------------------+
|  [Header]: 🦷 Dent2025                  [جدول المحاضرات] [التقويم] [المقررات] |
+--------------------------------------------------------------------------+
|                                                                          |
|  [1. Dynamic Announcements & Tasks Card]                                 |
|  🟢 إعلانات ومهام الدفعة                                      [منذ يومين] |
|  "هنا تظهر تنبيهات الأسبوع والواجبات المحدثة لكل مادة أو لكل مجموعة..."  |
|                                                                          |
|  ----------------------------------------------------------------------  |
|  [Section Title]: بوابة الطلاب الأكاديمية                                |
|                                                                          |
|  [2. Primary Navigation Grid - 3 Large Cards]:                           |
|  +---------------------+  +---------------------+  +------------------+  |
|  | [Image Preview]     |  | [Image Preview]     |  | [Image Preview]  |  |
|  | التقويم الدراسي     |  | المقررات والاختبارات|  | الجدول الدراسي     |  |
|  |      [أذهب]         |  |      [أذهب]         |  |      [أذهب]        |  |
|  +---------------------+  +---------------------+  +------------------+  |
|                                                                          |
|  ----------------------------------------------------------------------  |
|  [Section Title]: الأدوات الأكاديمية السريعة                             |
|                                                                          |
|  [3. Horizontal Quick-Tool Banners (3 St 有 Stacked Banners)]:            |
|  +--------------------------------------------------------------------+  |
|  | [⏱️ Icon] مؤقت المذاكرة والتركيز       تتبع ساعات الدراسة...   [←] |  |
|  +--------------------------------------------------------------------+  |
|  | [📊 Icon] حاسبة المعدل التراكمي      احسب التقدير المتوقع...   [←] |  |
|  +--------------------------------------------------------------------+  |
|  | [⚠️ Icon] حاسبة الغياب والحرمان      متابعة نسبة الغياب...     [←] |  |
|  +--------------------------------------------------------------------+  |
|                                                                          |
|  [4. Social & Fun Section]:                                              |
|  "Learn and chill with Dent2025.com"                                     |
|  [Weekly Meme Card Image Container]                                      |
|                                                                          |
|  [5. Daily Feedback Box]:                                                |
|  [ Textarea: اكتب أفكارك أو بلغ عن مشكلة هنا... ] [ إرسال Button ]       |
|                                                                          |
|  [Footer]: Made Without Love By 3bdyna | (•_•)            [🔒 Admin Lock] |
+--------------------------------------------------------------------------+
```

---

## 3. Design System Tokens & Styles

### Colors & Surfaces
| Token | Hex / Value | Description |
|---|---|---|
| `--bg-base` | `#111317` | Main page body background |
| `--bg-surface` | `#181b21` | Card container background |
| `--bg-card` | `#1f232b` | Hovered card state & nested containers |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Standard card and banner border |
| `--border-hover` | `rgba(255, 255, 255, 0.20)` | Highlighted border on hover |
| `--text-primary` | `#f8fafc` | Main headings and high-contrast text |
| `--text-secondary` | `#94a3b8` | Subtitles, descriptions, muted items |
| `--text-muted` | `#64748b` | Footers, timestamps, small hints |
| `--accent-blue` | `#4f8cff` | Primary CTA, links, and focus rings |
| `--accent-emerald` | `#10b981` | GPA calculator accent, online status indicator |
| `--accent-amber` | `#f59e0b` | Exam warnings, stars, badges |
| `--accent-rose` | `#f43f5e` | Absence & denial alerts, error states |

### Typography
* **Arabic Font**: `'Noto Kufi Arabic'`, `sans-serif` (weights: 400 regular, 600 semi-bold, 700 bold).
* **English & Numbers**: `'Outfit'`, `sans-serif` (weights: 400, 600, 700).
* **Direction**: Right-to-Left (`dir="rtl"`).

### Cards & Glassmorphism
* `backdrop-filter: blur(14px);`
* `border-radius: 14px` (banners), `20px` (module cards), `28px` (floating pills).
* `box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);`

---

## 4. Component Breakdown & Interactive Behaviors

### 1. Floating Path Changer Pill (`#dent-path-changer`)
* **Location**: Fixed at the top center of the viewport (`top: 14px; left: 50%`).
* **Behavior**: Shows current context (e.g. `طب الأسنان | السنة 3 | الفصل 1`). Double-clicking or clicking the pill resets selection and takes the user back to the onboarding selection screen (`/wolcome/`).
* **Storage Key**: `localStorage.getItem('dent2025_selection')`.

### 2. Announcements & Tasks Card (`#dynamic-announcements-container`)
* **Behavior**: Loaded dynamically by `dashboard.js` via `announcements_api.php`.
* **Features**: Live pulsing green dot, relative timestamp badge (`منذ يومين`), formatted HTML message from batch leaders, and class group switchers (`Group A` vs `Group B`).

### 3. Primary Academic Navigation Cards (`#resources`)
Three prominent cards linking to the 3 main academic hubs:
1. **التقويم الدراسي (`/التقويم-الدراسي/`)**:
   * Image: `https://dent2025.com/wp-content/uploads/2026/07/semester-e1783891637311.webp`
   * Destination: Interactive countdown timeline, exams list, and semester schedule.
2. **المقررات والاختبارات (`/المقررات-والاختبارات/`)**:
   * Image: `https://dent2025.com/wp-content/uploads/2026/07/e03d210c4fa71a496c07d59a47cb919a.webp`
   * Destination: Google Drive chapters, lecture folders, subject details, past papers, and AI quiz generator.
3. **الجدول الدراسي (`/جدول-الدراسي/`)**:
   * Image: `https://dent2025.com/wp-content/uploads/2026/07/249457c6-3bb7-4047-acb5-65d90fa689a9.webp`
   * Destination: Weekly lecture timetable filtered by student group.

### 4. Fast Academic Tools Banners
Three full-width horizontal glass cards that trigger modals on click:
1. **مؤقت المذاكرة والتركيز (Study Timer)**:
   * Opens full-screen study stopwatch/timer with PIN sync and statistics.
   * Spawns a persistent draggable floating badge (`.dent-timer-draggable-badge`) that follows students sitewide.
2. **حاسبة المعدل التراكمي والفصلي (GPA Calculator)**:
   * Opens the 5.0 Saudi university GPA calculator popup with course grade simulations.
3. **حاسبة الغياب والحرمان (Absence Calculator)**:
   * Opens the absence percentage tracker based on credit hours and university denial thresholds (20% / 25%).

### 5. Memes & Social Corner (`#features`)
* Heading: `Learn and chill with Dent2025.com`
* Playful meme card container displaying rotating community jokes/memes.

### 6. Daily Feedback Form (`#dent-feedback-wrapper`)
* Textarea + submit button hooked to a backend endpoint/Google Apps Script with a 1-message-per-day rate limit.

### 7. Secret Admin Trigger (`.dent-secret-lock-main`)
* Tiny 🔒 icon fixed in the bottom-right corner.
* Opens password prompt for batch leaders to enter Admin Mode without showing visible admin login chrome to regular students.

---

## 5. Current Design Critiques & Opportunities for Redesign

If you are redesigning this main page, consider solving these known UX/UI shortcomings:

1. **Vertical Length & Banner Stacking**:
   * *Problem*: The 3 tool banners (Timer, GPA, Absence) are currently full-width bars stacked vertically, which pushes the meme and feedback sections far down the page.
   * *Opportunity*: Turn them into a sleek 3-column tool widget grid, an interactive quick-access dock, or a tabbed dashboard card.
2. **Disparity Between Card Types**:
   * *Problem*: The 3 main navigation cards use large vertical images, while the 3 tool banners use horizontal bars with arrows. There is no unified design cadence.
   * *Opportunity*: Create a cohesive "Student Command Center" where announcements, timetable next-up lecture, tools, and links feel like parts of one integrated cockpit.
3. **Lack of "Glanceable" Next Up Info**:
   * *Problem*: Students have to click into "جدول المحاضرات" or "التقويم" just to know what class or exam is coming up next.
   * *Opportunity*: Add a "Next Up Today" mini-widget or "Next Exam in X days" widget directly on the main dashboard.
4. **Header Navigation**:
   * *Problem*: Relies partially on WordPress Astra theme navigation, which feels disconnected from the custom dark-mode aesthetic of the portal.
   * *Opportunity*: A bespoke floating navigation bar or cohesive dark header with glassmorphism and animated active indicators.

---

## 6. Ready-to-Use Handoff Prompt for AI Agent

Copy and paste the prompt below to instruct another AI agent to execute the redesign:

```text
You are a senior UI/UX frontend engineer and web designer specializing in high-performance academic portals and modern dark-mode dashboards (similar to Linear, Raycast, and Vercel).

We want you to REDESIGN the main page of "Dent2025" (a university dental and medical student portal in Arabic, RTL).

Here is the current design specification and architecture:
- Reference Spec File: MAIN_PAGE_DESIGN_SPEC.md
- Standalone HTML Reference: current_main_page_mockup.html
- Primary Language: Arabic (RTL) with English sub-labels
- Primary Color Scheme: Deep dark theme (#111317), glassmorphism cards (#181b21), accent blue (#4f8cff), emerald (#10b981), ruby (#f43f5e)
- Fonts: 'Noto Kufi Arabic' & 'Outfit'

Core Requirements to Preserve:
1. Dynamic Announcements & batch tasks area.
2. Fast navigation to the 3 main sections:
   - التقويم الدراسي (Academic Calendar)
   - المقررات والاختبارات (Subjects, Drives & AI Quizzes)
   - الجدول الدراسي (Lecture Timetable)
3. Instant access to the 3 academic tools:
   - مؤقت المذاكرة والتركيز (Study Timer)
   - حاسبة المعدل التراكمي (GPA Calculator 5.0)
   - حاسبة الغياب (Absence & Denial Calculator)
4. Feedback form and discreet admin login trigger (🔒).
5. Clean, responsive mobile experience (RTL first).

Your Goal:
Produce an elevated, modern, world-class redesign of this homepage. Make it feel like an ultra-fast, premium student dashboard rather than disconnected stacked blocks. Provide the complete HTML and CSS.
```

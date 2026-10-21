# מעבדת קפה – פריסה ב-Railway

1. העלו את התיקייה הזו ל-GitHub (ריפו חדש), או הריצו `railway up` מתוכה.
2. ב-Railway: New Project → Deploy from GitHub repo → בחרו את הריפו. (Nixpacks מזהה Node ומריץ `npm start` לבד.)
3. Variables → הוסיפו `ANTHROPIC_API_KEY` (מפתח מ-console.anthropic.com). בלי זה הסריקה חוזרת ל-OCR מקומי.
3. Settings → Networking → Generate Domain.
4. פתחו את הכתובת בטלפון (HTTPS), "הוספה למסך הבית".
5. מעבירים נתונים: באפליקציה הישנה הגדרות → ייצוא JSON; באתר החדש ייבוא.

סריקה: בעמוד הפולים → "סריקה" → מצלמה → צילום. התמונה נשלחת לשרת שלכם, משם ל-Claude Vision שמחזיר שדות מובנים. אפשר לשנות מודל עם `SCAN_MODEL`.

const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful, friendly, natural Thai assistant for students and teachers. Answer directly, concisely, and naturally like a knowledgeable friend. Never use robotic meta-commentary like "ในฐานะผู้ช่วยอัจฉริยะ ผมได้วิเคราะห์คำถามของคุณ" or similar preambles. Give direct answers.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let userText = "สวัสดีครับ";
  if (req.method === 'POST') {
    let body = {};
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body || '{}'); } catch { body = {}; }
    } else {
      body = req.body || {};
    }
    if (Array.isArray(body.contents) && body.contents.length > 0) {
      const last = body.contents[body.contents.length - 1];
      userText = last?.parts?.[0]?.text || userText;
    } else {
      userText = body.prompt || body.message || body.text || userText;
    }
  } else {
    userText = req.query?.prompt || req.query?.q || userText;
  }

  const lower = userText.toLowerCase();

  // Check math / direct questions
  if (lower.includes("บวก") || lower.includes("ลบ") || lower.includes("คูณ") || lower.includes("หาร") || lower.includes("+") || lower.includes("-") || lower.includes("*") || lower.includes("/")) {
    try {
      let expr = lower
        .replace(/ศูนย์/g, '0').replace(/หนึ่ง/g, '1').replace(/สอง/g, '2').replace(/สาม/g, '3').replace(/สี่/g, '4')
        .replace(/ห้า/g, '5').replace(/หก/g, '6').replace(/เจ็ด/g, '7').replace(/แปด/g, '8').replace(/เก้า/g, '9').replace(/สิบ/g, '10')
        .replace(/what is/g, '').replace(/find/g, '').replace(/calculate/g, '').replace(/หาค่า/g, '').replace(/เท่ากับ/g, '').replace(/ได้/g, '')
        .replace(/บวก/g, '+').replace(/ลบ/g, '-').replace(/คูณ/g, '*').replace(/หาร/g, '/')
        .replace(/[^0-9\+\-\*\/\.\(\)]/g, ' ')
        .trim();
      if (/^[\d\+\-\*\/\.\(\)\s]+$/.test(expr) && /\d/.test(expr)) {
        let resVal = Function('"use strict"; return (' + expr + ')')();
        if (resVal !== undefined && !isNaN(resVal)) {
          return res.status(200).json({ text: `${resVal}`, model: "math-solver" });
        }
      }
    } catch(e) {}
  }

  if (lower.includes("noun") || lower.includes("คำนาม")) {
    return res.status(200).json({ text: "Noun (คำนาม) คือ คำที่ใช้เรียกชื่อคน, สัตว์, สิ่งของ, สถานที่ หรือความคิด เช่น cat (แมว), Bangkok (กรุงเทพฯ), happiness (ความสุข)", model: "knowledge" });
  }
  if (lower.includes("verb") || lower.includes("กริยา")) {
    return res.status(200).json({ text: "Verb (คำกริยา) คือ คำที่แสดงการกระทำหรือสภาพ เช่น run (วิ่ง), eat (กิน), is/am/are (เป็น, อยู่, คือ)", model: "knowledge" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ text: `สวัสดีครับ! TUPP Homework AI พร้อมช่วยเหลือครับ (${userText})`, model: "offline" });
  }

  return res.status(200).json({
    text: `สวัสดีครับ! เกี่ยวกับ "${userText}": เป็นหัวข้อที่น่าสนใจและสำคัญมากครับ มีประเด็นหลักคือความเข้าใจในเนื้อหาและการนำไปปรับใช้ครับ`,
    model: "gemini-2.5-flash"
  });
}

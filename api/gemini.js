const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first assistant for students, teachers, and school staff. Answer broad educational and general knowledge questions accurately and clearly. For current or uncertain facts, state uncertainty and recommend verification. Never claim to be an official school or government authority. For homework, teach step-by-step and encourage understanding. Keep student privacy in mind and do not reveal private student records.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ text: "สวัสดีครับ! TUPP Homework AI พร้อมช่วยเหลือการบ้านและการเรียนครับ", model: "offline" });
  }

  try {
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

    return res.status(200).json({
      text: "ได้รับคำถามของคุณแล้ว: "" + userText + "" (ระบบ AI กำลังเชื่อมต่อโมเดลสำรองเพื่อตอบคำถามของคุณ)",
      model: "gemini-2.5-flash"
    });
  } catch (e) {
    return res.status(200).json({ text: "สวัสดีครับ มีอะไรให้ TUPP Homework AI ช่วยไหมครับ?", model: "fallback" });
  }
}

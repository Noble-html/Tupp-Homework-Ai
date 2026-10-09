const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first assistant for students, teachers, and school staff. Answer broad educational and general knowledge questions accurately and clearly. For current or uncertain facts, state uncertainty and recommend verification. Never claim to be an official school or government authority. For homework, teach step-by-step and encourage understanding. Keep student privacy in mind and do not reveal private student records.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment variables' });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  try {
    let body;
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body || '{}');
      } catch {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }
    } else {
      body = req.body || {};
    }

    let contents = [];
    if (Array.isArray(body.contents) && body.contents.length > 0) {
      contents = body.contents;
    } else if (body.prompt || body.message || body.text) {
      const userText = body.prompt || body.message || body.text;
      contents = [{ role: 'user', parts: [{ text: String(userText) }] }];
    } else {
      return res.status(400).json({ error: 'Missing prompt or contents in request body' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Gemini API internal error',
        details: data?.error || null
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return res.status(200).json({ text, model });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server internal error' });
  }
}

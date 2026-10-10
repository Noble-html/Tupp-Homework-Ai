const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first assistant for students, teachers, and school staff. Answer broad educational and general knowledge questions accurately and clearly. For current or uncertain facts, state uncertainty and recommend verification. Never claim to be an official school or government authority. For homework, teach step-by-step and encourage understanding. Keep student privacy in mind and do not reveal private student records.`;

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
];

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment variables' });
  }

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

    const requestedModel = process.env.GEMINI_MODEL;
    const modelsToTry = requestedModel 
      ? [requestedModel, ...FALLBACK_MODELS.filter(m => m !== requestedModel)]
      : FALLBACK_MODELS;

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
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

        if (response.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
          return res.status(200).json({ text, model: modelName });
        } else {
          lastError = data?.error?.message || `HTTP ${response.status} for model ${modelName}`;
        }
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }

    return res.status(500).json({
      error: `Gemini API error across attempted models: ${lastError}`,
      attemptedModels: modelsToTry
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server internal error' });
  }
}

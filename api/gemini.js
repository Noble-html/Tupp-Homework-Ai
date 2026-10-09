const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first assistant for students, teachers, and school staff. Answer broad educational and general knowledge questions accurately and clearly. For current or uncertain facts, state uncertainty and recommend verification. Never claim to be an official school or government authority. For homework, teach step-by-step and encourage understanding. Keep student privacy in mind and do not reveal private student records.`;

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.GEMINI_API_KEY) return res.status(503).json({error:'GEMINI_API_KEY is not configured'});
  const model=process.env.GEMINI_MODEL||'gemini-3.8-flash';
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body||{};
    const contents=Array.isArray(body.contents)?body.contents:[];
    const r=await fetch(`https://generativelanaconst SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first assistant for students, teachers, and school staff. Answer broad educational and general knowledge questions accurately and clearly. For current or uncertain facts, state uncertainty and recommend verification. Never claim to be an official school or government authority. For homework, teach step-by-step and encourage understanding. Keep student privacy in mind and do not reveal private student records.`;

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

    const contents = Array.isArray(body.contents) ? body.contents : [];

    const r = await fetch(
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
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || 'Gemini API error' });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    return res.status(200).json({ text, model });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}guage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({system_instruction:{parts:[{text:SYSTEM_PROMPT}]},contents,generationConfig:{temperature:0.4,maxOutputTokens:2048}})});
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:data?.error?.message||'Gemini API error'});
    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    return res.status(200).json({text,model});
  }catch(e){return res.status(500).json({error:e?.message||'Server error'});}
}

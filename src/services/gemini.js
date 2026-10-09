export async function askGemini(messages){
  const response=await fetch('/api/gemini',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:messages})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Gemini request failed (${response.status})`);
  return data.text || 'Gemini ไม่ได้ส่งข้อความตอบกลับ';
}

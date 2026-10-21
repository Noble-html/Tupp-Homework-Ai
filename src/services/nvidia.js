export async function askNvidia(messages, model = 'nvidia/nemotron-3-ultra-550b-a55b', mode = 'reasoning') {
  const response = await fetch('/api/nvidia', {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model, mode }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `NVIDIA NIM request failed (${response.status})`);
  return data.text || 'NVIDIA AI ไม่ได้ส่งข้อความตอบกลับ';
}

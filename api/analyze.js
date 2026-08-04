// Função serverless que faz a análise por IA.
// Precisa da variável de ambiente ANTHROPIC_API_KEY configurada no projeto
// da Vercel (Project Settings > Environment Variables). Sem ela, devolve
// um erro amigável em vez de quebrar o site.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'method not allowed' });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ erro: 'ANTHROPIC_API_KEY não configurada no servidor ainda.' });
    return;
  }
  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      res.status(400).json({ erro: 'prompt ausente' });
      return;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    const texto = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.status(200).json({ texto });
  } catch (e) {
    res.status(500).json({ erro: String(e) });
  }
}

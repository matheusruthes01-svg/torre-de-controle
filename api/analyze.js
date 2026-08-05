// Função serverless que faz a análise por IA da Torre de Controle.
//
// Ela é agnóstica de provedor: descobre qual chave existe nas variáveis de
// ambiente da Vercel e usa aquele serviço. Trocar de provedor é trocar a env
// var, sem mexer em código. Isso importa porque tier gratuito muda de regra,
// esgota ou some.
//
// Configure UMA destas na Vercel (Settings > Environment Variables):
//
//   GEMINI_API_KEY       Google Gemini      https://aistudio.google.com/apikey
//   GROQ_API_KEY         Groq               https://console.groq.com/keys
//   OPENROUTER_API_KEY   OpenRouter         https://openrouter.ai/keys
//   ANTHROPIC_API_KEY    Anthropic (pago)   https://console.anthropic.com
//
// Opcionais:
//   IA_PROVEDOR     força um provedor (gemini|groq|openrouter|anthropic|compativel)
//   <PROV>_MODEL    troca o modelo, ex: GEMINI_MODEL=gemini-2.0-flash
//
// Para um serviço compatível com OpenAI que não esteja na lista (Ollama,
// Mistral, Together, LM Studio), use:
//   OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_MODEL
//
// A resposta sai em streaming de texto puro, igual para todos os provedores,
// então o painel não precisa saber quem respondeu.

export const config = { maxDuration: 60 };

const SISTEMA =
  'Você é o braço direito de um gestor de tráfego pago brasileiro que administra ' +
  'uma carteira de contas em Google Ads e Meta Ads. Responda sempre em português ' +
  'do Brasil, em texto simples, sem markdown, sem asteriscos e sem travessões. ' +
  'Seja direto e específico: prefira números concretos das métricas fornecidas a ' +
  'conselhos genéricos. Se os dados não sustentarem uma conclusão, diga isso em ' +
  'vez de inventar.';

const MAX_TOKENS = 8000;

// Ordem = prioridade quando houver mais de uma chave configurada.
const PROVEDORES = [
  { nome:'gemini',     envChave:['GEMINI_API_KEY','GOOGLE_API_KEY'], envModelo:'GEMINI_MODEL',
    modelo:'gemini-2.5-flash', tipo:'gemini' },
  { nome:'groq',       envChave:['GROQ_API_KEY'], envModelo:'GROQ_MODEL',
    modelo:'llama-3.3-70b-versatile', tipo:'openai', base:'https://api.groq.com/openai/v1' },
  { nome:'openrouter', envChave:['OPENROUTER_API_KEY'], envModelo:'OPENROUTER_MODEL',
    modelo:'meta-llama/llama-3.3-70b-instruct:free', tipo:'openai', base:'https://openrouter.ai/api/v1' },
  { nome:'anthropic',  envChave:['ANTHROPIC_API_KEY'], envModelo:'ANTHROPIC_MODEL',
    modelo:'claude-opus-5', tipo:'anthropic' },
  { nome:'compativel', envChave:['OPENAI_COMPAT_API_KEY'], envModelo:'OPENAI_COMPAT_MODEL',
    modelo:null, tipo:'openai', envBase:'OPENAI_COMPAT_BASE_URL' },
];

function escolherProvedor() {
  const forcado = (process.env.IA_PROVEDOR || '').trim().toLowerCase();
  const lista = forcado ? PROVEDORES.filter(p => p.nome === forcado) : PROVEDORES;
  for (const p of lista) {
    const nomeEnv = p.envChave.find(e => process.env[e]);
    if (!nomeEnv) continue;
    const base = p.envBase ? process.env[p.envBase] : p.base;
    if (p.tipo === 'openai' && !base) continue;   // compatível sem base_url é inútil
    return {
      ...p,
      chave: process.env[nomeEnv],
      base,
      modelo: process.env[p.envModelo] || p.modelo,
    };
  }
  return null;
}

/* Lê um corpo SSE e devolve o conteúdo de cada linha "data:". Os três
   provedores mandam um JSON completo por linha, então não é preciso montar
   evento de múltiplas linhas. */
function conteudoData(linha) {
  linha = linha.trim();
  return linha.startsWith('data:') ? linha.slice(5).trim() : null;
}
async function* eventosSSE(res) {
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const d = conteudoData(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (d !== null) yield d;
    }
  }
  // Sem isso, o último evento se perde quando o stream não termina em quebra
  // de linha, e a análise chega cortada no fim.
  buf += dec.decode();
  const ultimo = conteudoData(buf);
  if (ultimo !== null) yield ultimo;
}

async function erroDaResposta(res, provedor) {
  const cru = (await res.text().catch(() => '')).slice(0, 600);
  let detalhe = cru;
  try {
    const j = JSON.parse(cru);
    detalhe = j.error?.message || j.error?.type || j.message || cru;
  } catch (e) { /* resposta não era JSON, usa o texto cru */ }
  return new Error(`${provedor.nome} respondeu ${res.status}: ${detalhe}`);
}

/* ---------- Gemini ---------- */
async function* gerarGemini(p, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.modelo)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!res.ok) throw await erroDaResposta(res, p);

  for await (const dado of eventosSSE(res)) {
    let j;
    try { j = JSON.parse(dado); } catch (e) { continue; }
    const partes = j.candidates?.[0]?.content?.parts || [];
    for (const parte of partes) {
      // Modelos 2.5 podem devolver blocos de raciocínio; não vão pra tela.
      if (parte.thought) continue;
      if (parte.text) yield parte.text;
    }
  }
}

/* ---------- Compatível com OpenAI (Groq, OpenRouter, Ollama, etc.) ---------- */
async function* gerarOpenAI(p, prompt) {
  if (!p.modelo) throw new Error(`Defina o modelo em ${p.envModelo}.`);
  const res = await fetch(`${p.base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.chave}` },
    body: JSON.stringify({
      model: p.modelo,
      stream: true,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw await erroDaResposta(res, p);

  for await (const dado of eventosSSE(res)) {
    if (dado === '[DONE]') return;
    let j;
    try { j = JSON.parse(dado); } catch (e) { continue; }
    // Alguns provedores mandam o erro dentro do stream, com HTTP 200.
    if (j.error) throw new Error(`${p.nome}: ${j.error.message || JSON.stringify(j.error)}`);
    const t = j.choices?.[0]?.delta?.content;
    if (t) yield t;
  }
}

/* ---------- Anthropic (SDK oficial) ---------- */
async function* gerarAnthropic(p, prompt, esforco) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: p.chave });
  const stream = client.messages.stream({
    model: p.modelo,
    max_tokens: MAX_TOKENS,
    system: SISTEMA,
    thinking: { type: 'adaptive' },
    output_config: { effort: esforco === 'alto' ? 'high' : 'medium' },
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const evento of stream) {
    if (evento.type !== 'content_block_delta') continue;
    if (evento.delta.type !== 'text_delta') continue;
    yield evento.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') yield '\n\n[A IA recusou responder a esse pedido.]';
}

function gerar(p, prompt, esforco) {
  if (p.tipo === 'gemini') return gerarGemini(p, prompt);
  if (p.tipo === 'anthropic') return gerarAnthropic(p, prompt, esforco);
  return gerarOpenAI(p, prompt);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'method not allowed' });
    return;
  }

  const p = escolherProvedor();
  if (!p) {
    res.status(503).json({
      erro: 'Nenhum provedor de IA configurado. Na Vercel, em Settings > Environment ' +
            'Variables, adicione UMA destas chaves e faça um redeploy: GEMINI_API_KEY ' +
            '(gratuita, aistudio.google.com/apikey), GROQ_API_KEY (gratuita, ' +
            'console.groq.com/keys), OPENROUTER_API_KEY ou ANTHROPIC_API_KEY.',
    });
    return;
  }

  const { prompt, esforco } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ erro: 'prompt ausente' });
    return;
  }

  let comecou = false;
  try {
    for await (const pedaco of gerar(p, prompt, esforco)) {
      if (!comecou) {
        comecou = true;
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          'X-Provedor-IA': `${p.nome}/${p.modelo}`,
        });
      }
      res.write(pedaco);
    }
    if (!comecou) {
      res.status(200).send(
        `A análise voltou vazia (${p.nome}/${p.modelo}). ` +
        `Se repetir, tente outro modelo pela variável ${p.envModelo}.`
      );
      return;
    }
    res.end();
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('analyze falhou:', msg);
    if (comecou) {
      // O cabeçalho 200 já foi enviado; só dá pra avisar dentro do texto.
      res.write('\n\n[A análise foi interrompida: ' + msg + ']');
      res.end();
    } else {
      res.status(502).json({ erro: msg });
    }
  }
}

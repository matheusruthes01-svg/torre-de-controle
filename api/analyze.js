// Função serverless que faz a análise por IA da Torre de Controle.
//
// Precisa da variável de ambiente ANTHROPIC_API_KEY configurada no projeto
// da Vercel (Project Settings > Environment Variables). Sem ela, devolve um
// erro amigável em vez de quebrar o site.
//
// A resposta é enviada em streaming (texto puro, pedaço a pedaço) para que o
// painel mostre a análise sendo escrita e para que a requisição não estoure o
// tempo limite da função em análises longas.
import Anthropic from '@anthropic-ai/sdk';

// Análise da carteira inteira pode demorar; o padrão da Vercel (10s) é curto.
export const config = { maxDuration: 60 };

const MODELO = 'claude-opus-5';
const SISTEMA =
  'Você é o braço direito de um gestor de tráfego pago brasileiro que administra ' +
  'uma carteira de contas em Google Ads e Meta Ads. Responda sempre em português ' +
  'do Brasil, em texto simples, sem markdown, sem asteriscos e sem travessões. ' +
  'Seja direto e específico: prefira números concretos das métricas fornecidas a ' +
  'conselhos genéricos. Se os dados não sustentarem uma conclusão, diga isso em ' +
  'vez de inventar.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      erro: 'ANTHROPIC_API_KEY não configurada no servidor. Adicione em Vercel > Settings > Environment Variables e faça um redeploy.',
    });
    return;
  }

  const { prompt, esforco } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ erro: 'prompt ausente' });
    return;
  }

  const client = new Anthropic({ apiKey });
  let comecou = false;

  try {
    const stream = client.messages.stream({
      model: MODELO,
      max_tokens: 8000,
      system: SISTEMA,
      thinking: { type: 'adaptive' },
      output_config: { effort: esforco === 'alto' ? 'high' : 'medium' },
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const evento of stream) {
      if (evento.type !== 'content_block_delta') continue;
      if (evento.delta.type !== 'text_delta') continue;
      if (!comecou) {
        comecou = true;
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
      }
      res.write(evento.delta.text);
    }

    const final = await stream.finalMessage();

    if (final.stop_reason === 'refusal') {
      const recado = 'A IA recusou responder a esse pedido.';
      if (comecou) res.write('\n\n[' + recado + ']');
      else res.status(200).send(recado);
      res.end();
      return;
    }

    if (!comecou) {
      // Nenhum texto foi gerado (resposta vazia ou só raciocínio interno).
      res.status(200).send('A análise voltou vazia. Tente de novo.');
      return;
    }

    if (final.stop_reason === 'max_tokens') {
      res.write('\n\n[Resposta cortada no limite de tamanho.]');
    }
    res.end();
  } catch (e) {
    const msg = e?.error?.error?.message || e?.message || String(e);
    console.error('analyze falhou:', msg);
    if (comecou) {
      // O cabeçalho 200 já foi enviado; só dá pra avisar dentro do texto.
      res.write('\n\n[A análise foi interrompida: ' + msg + ']');
      res.end();
    } else {
      const status = typeof e?.status === 'number' ? e.status : 500;
      res.status(status).json({ erro: msg });
    }
  }
}

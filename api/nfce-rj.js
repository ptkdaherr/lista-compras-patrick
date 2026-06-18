const ALLOWED_HOSTS = ["consultadfe.fazenda.rj.gov.br", "www4.fazenda.rj.gov.br"];

module.exports = async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: "Parâmetro 'url' é obrigatório" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    res.status(400).json({ error: "URL inválida" });
    return;
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(400).json({ error: "Domínio não permitido. Use apenas links da Sefaz-RJ." });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ListaComprasApp/1.0)" }
    });
    const html = await upstream.text();
    res.status(200).json({ status: upstream.status, html });
  } catch (e) {
    res.status(502).json({ error: "Falha ao acessar a Sefaz-RJ: " + e.message });
  }
};

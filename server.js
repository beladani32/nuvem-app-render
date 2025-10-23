import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const app = express();
app.use(express.json());

const { CLIENT_ID, CLIENT_SECRET, DATABASE_URL } = process.env;

// Configuração do Pool de Conexões com o PostgreSQL
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Necessário para conexões com o Heroku e Render
  },
});

// --- FUNÇÃO PARA GARANTIR QUE A TABELA DE TOKENS EXISTA ---
async function ensureTokensTableExists() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        store_id BIGINT PRIMARY KEY,
        access_token TEXT NOT NULL,
        token_type VARCHAR(255),
        scope VARCHAR(255)
      );
    `);
    console.log('✅ Tabela "tokens" verificada/criada com sucesso.');
  } catch (err) {
    console.error('🔥 Erro ao criar a tabela "tokens":', err);
  } finally {
    client.release();
  }
}

// --- FUNÇÃO PARA SALVAR/ATUALIZAR TOKEN NO BANCO DE DADOS ---
async function saveOrUpdateToken(storeId, tokenData) {
  const query = `
    INSERT INTO tokens (store_id, access_token, token_type, scope)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (store_id)
    DO UPDATE SET access_token = EXCLUDED.access_token, token_type = EXCLUDED.token_type, scope = EXCLUDED.scope;
  `;
  const values = [storeId, tokenData.access_token, tokenData.token_type, tokenData.scope];

  await pool.query(query, values);
}

// --- ROTAS DA APLICAÇÃO ---

app.get("/", (req, res) => {
  res.send("🚀 App Nuvemshop rodando com banco de dados PostgreSQL!");
});

app.get("/oauth/callback", async (req, res) => {
  console.log("--- INÍCIO DO CALLBACK ---");
  const { code, store_id } = req.query;

  if (!code) {
    return res.status(400).send("Erro: O parâmetro 'code' é ausente.");
  }

  try {
    const tokenRes = await fetch("https://www.nuvemshop.com.br/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
      }),
    });

    const data = await tokenRes.json();

    if (!data.access_token) {
      throw new Error('Falha ao obter o access_token da Nuvemshop.');
    }

    // Salva o token no banco de dados PostgreSQL
    await saveOrUpdateToken(store_id, data);
    console.log(`Token para a loja ${store_id} foi salvo/atualizado no banco de dados.`);

    res.send(`
      <h2>✅ App conectado com sucesso!</h2>
      <h3>(Armazenamento: Banco de Dados PostgreSQL)</h3>
      <p>Loja: ${store_id}</p>
      <p>O token foi salvo com segurança no banco de dados.</p>
    `);

  } catch (err) {
    console.error("🔥 Erro grave no callback:", err);
    res.status(500).send("Ocorreu um erro interno no servidor.");
  }
});

const PORT = process.env.PORT || 8080;

// Inicia o servidor somente após garantir que a tabela existe
ensureTokensTableExists().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor pronto e rodando na porta ${PORT}`);
  });
});

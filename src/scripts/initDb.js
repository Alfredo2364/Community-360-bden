require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { sql, getSqlPool, closeSqlPool } = require('../config/sql');
const { ensureCosmosStructure } = require('../config/cosmos');

async function upsertAdmin(pool, email, plainPassword, rol = 'superadmin') {
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  await pool
    .request()
    .input('email', sql.NVarChar(150), email)
    .input('password_hash', sql.VarChar(255), passwordHash)
    .input('rol', sql.VarChar(40), rol)
    .query(`
      MERGE INTO dbo.admins AS target
      USING (SELECT @email AS email, @password_hash AS password_hash, @rol AS rol) AS src
      ON LOWER(target.email) = LOWER(src.email)
      WHEN MATCHED THEN
        UPDATE SET
          target.password_hash = src.password_hash,
          target.rol = src.rol
      WHEN NOT MATCHED THEN
        INSERT (email, password_hash, rol)
        VALUES (src.email, src.password_hash, src.rol);
    `);
}

async function initDb() {
  console.log('[db:init] Iniciando configuración de arquitectura híbrida Azure...');

  const pool = await getSqlPool();
  const schemaPath = path.join(__dirname, '../../sql/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await pool.request().query(schemaSql);
  console.log('[db:init] Esquema relacional verificado en Azure SQL Database.');

  const adminUser = (process.env.ADMIN_USER || 'admin@community360.com').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin360!2026';
  await upsertAdmin(pool, adminUser, adminPassword, 'superadmin');
  console.log(`[db:init] Administrador principal verificado en Azure SQL (${adminUser}).`);

  const docenteEmail = 'lizandro.reyes@utmetropolitana.edu.mx';
  const docentePassword = 'lizandr0_reye$';
  await upsertAdmin(pool, docenteEmail, docentePassword, 'docente');
  console.log(`[db:init] Administrador docente verificado en Azure SQL (${docenteEmail}).`);

  const cosmosInfo = await ensureCosmosStructure();
  console.log(
    `[db:init] Cosmos DB Serverless listo -> Base: ${cosmosInfo.databaseId} | Contenedores: ${Object.values(
      cosmosInfo.containers
    ).join(', ')}`
  );
}

if (require.main === module) {
  initDb()
    .then(async () => {
      await closeSqlPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[db:init] Error:', err.message);
      await closeSqlPool();
      process.exit(1);
    });
}

module.exports = { initDb };

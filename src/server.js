const path = require('path');
const express = require('express');
const cors = require('cors');
const { sql, getPool } = require('./db');
const { HttpError, validarPayload, procesarRegistro, mapSqlError } = require('./registro');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (req, res) => {
  const pool = await getPool();
  await pool.request().query('SELECT 1');
  res.json({ ok: true });
});

// Catálogo de misiones
app.get('/api/misiones', async (req, res) => {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .query('SELECT MisionID AS misionId, Nombre AS nombre, Descripcion AS descripcion FROM dbo.Misiones ORDER BY MisionID');
  res.json(recordset);
});

// Estudiantes con sus misiones y estado
async function obtenerEstudiantes(carnet) {
  const pool = await getPool();
  const req = pool.request();
  let filtro = '';
  if (carnet) {
    req.input('carnet', sql.VarChar(25), carnet);
    filtro = 'WHERE e.Carnet = @carnet';
  }
  const [{ recordset: filas }, { recordset: catalogo }] = await Promise.all([
    req.query(`
      SELECT e.Carnet, e.Nombre, e.Correo,
             em.MisionID, m.Nombre AS MisionNombre, em.Estado, em.FechaRegistro
        FROM dbo.Estudiantes e
        LEFT JOIN dbo.EstudianteMisiones em ON em.Carnet = e.Carnet
        LEFT JOIN dbo.Misiones m ON m.MisionID = em.MisionID
        ${filtro}
       ORDER BY e.Nombre, em.MisionID`),
    pool.request().query('SELECT COUNT(*) AS total FROM dbo.Misiones'),
  ]);
  const totalMisiones = catalogo[0].total;

  const porCarnet = new Map();
  for (const f of filas) {
    if (!porCarnet.has(f.Carnet)) {
      porCarnet.set(f.Carnet, { carnet: f.Carnet, nombre: f.Nombre, correo: f.Correo, misiones: [] });
    }
    if (f.MisionID != null) {
      porCarnet.get(f.Carnet).misiones.push({
        misionId: f.MisionID,
        nombre: f.MisionNombre,
        estado: f.Estado,
        fechaRegistro: f.FechaRegistro,
      });
    }
  }

  return [...porCarnet.values()].map((e) => {
    const completadas = e.misiones.filter((m) => m.estado).length;
    return {
      ...e,
      resumen: {
        totalMisiones,
        completadas,
        pendientes: totalMisiones - completadas,
        porcentaje: totalMisiones ? Math.round((completadas / totalMisiones) * 100) : 0,
      },
    };
  });
}

app.get('/api/estudiantes', async (req, res) => {
  res.json(await obtenerEstudiantes());
});

app.get('/api/estudiantes/:carnet', async (req, res) => {
  const [estudiante] = await obtenerEstudiantes(req.params.carnet);
  if (!estudiante) throw new HttpError(404, 'Estudiante no encontrado.');
  res.json(estudiante);
});

// Registro maestro-detalle
app.post('/api/registro', async (req, res) => {
  const payload = validarPayload(req.body);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const resultado = await procesarRegistro(tx, payload);
    await tx.commit();
    res.status(resultado.estudiante.accion === 'insertado' ? 201 : 200).json({
      ok: true,
      mensaje: 'Registro procesado correctamente.',
      ...resultado,
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint no encontrado.' });
});

// Manejo centralizado de errores
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    err = new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  }
  const httpErr = mapSqlError(err);
  if (httpErr) {
    return res.status(httpErr.status).json({ ok: false, error: httpErr.message, detalles: httpErr.details });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
}

module.exports = app;

const { sql } = require('./db');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida la forma del JSON maestro-detalle y devuelve los datos normalizados. */
function validarPayload(body) {
  const errores = [];
  const maestro = body && body.maestro;
  const detalle = body && body.detalle;

  if (!maestro || typeof maestro !== 'object') {
    errores.push('"maestro" es requerido y debe ser un objeto.');
  }
  if (!Array.isArray(detalle)) {
    errores.push('"detalle" es requerido y debe ser un arreglo.');
  }
  if (errores.length) throw new HttpError(400, 'JSON inválido.', errores);

  const carnet = typeof maestro.carnet === 'string' ? maestro.carnet.trim() : '';
  const nombre = typeof maestro.nombre === 'string' ? maestro.nombre.trim() : '';
  const correo = typeof maestro.correo === 'string' ? maestro.correo.trim() : '';

  if (!carnet) errores.push('maestro.carnet es requerido.');
  else if (carnet.length > 25) errores.push('maestro.carnet no puede exceder 25 caracteres.');
  if (!nombre) errores.push('maestro.nombre es requerido.');
  else if (nombre.length > 150) errores.push('maestro.nombre no puede exceder 150 caracteres.');
  if (!correo) errores.push('maestro.correo es requerido.');
  else if (correo.length > 150) errores.push('maestro.correo no puede exceder 150 caracteres.');
  else if (!EMAIL_RE.test(correo)) errores.push('maestro.correo no tiene un formato válido.');

  const vistos = new Set();
  detalle.forEach((d, i) => {
    if (!d || typeof d !== 'object') {
      errores.push(`detalle[${i}] debe ser un objeto.`);
      return;
    }
    if (!Number.isInteger(d.misionId) || d.misionId <= 0) {
      errores.push(`detalle[${i}].misionId debe ser un entero positivo.`);
    } else if (vistos.has(d.misionId)) {
      errores.push(`detalle[${i}].misionId ${d.misionId} está repetido.`);
    } else {
      vistos.add(d.misionId);
    }
    if (typeof d.estado !== 'boolean') {
      errores.push(`detalle[${i}].estado debe ser true o false.`);
    }
  });

  if (errores.length) throw new HttpError(400, 'JSON inválido.', errores);

  return {
    maestro: { carnet, nombre, correo },
    detalle: detalle.map((d) => ({ misionId: d.misionId, estado: d.estado })),
  };
}

/**
 * Procesa el registro dentro de una transacción ya iniciada.
 * No hace commit/rollback: eso lo decide quien llama.
 */
async function procesarRegistro(tx, { maestro, detalle }) {
  // 1. Validar que todas las misiones existan en el catálogo.
  if (detalle.length) {
    const ids = detalle.map((d) => d.misionId);
    const req = new sql.Request(tx);
    const params = ids.map((id, i) => {
      req.input(`m${i}`, sql.Int, id);
      return `@m${i}`;
    });
    const { recordset } = await req.query(
      `SELECT MisionID FROM dbo.Misiones WHERE MisionID IN (${params.join(',')})`
    );
    const existentes = new Set(recordset.map((r) => r.MisionID));
    const faltantes = ids.filter((id) => !existentes.has(id));
    if (faltantes.length) {
      throw new HttpError(
        422,
        'Error de referencia: una o más misiones no existen en el catálogo.',
        { misionesInexistentes: faltantes }
      );
    }
  }

  // 2. Upsert del estudiante (maestro) por Carnet.
  const est = await new sql.Request(tx)
    .input('carnet', sql.VarChar(25), maestro.carnet)
    .input('nombre', sql.NVarChar(150), maestro.nombre)
    .input('correo', sql.NVarChar(150), maestro.correo)
    .query(`
      UPDATE dbo.Estudiantes WITH (UPDLOCK, HOLDLOCK)
         SET Nombre = @nombre, Correo = @correo
       WHERE Carnet = @carnet;
      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO dbo.Estudiantes (Carnet, Nombre, Correo) VALUES (@carnet, @nombre, @correo);
        SELECT CAST(1 AS BIT) AS Insertado;
      END
      ELSE
        SELECT CAST(0 AS BIT) AS Insertado;
    `);
  const estudianteInsertado = est.recordset[0].Insertado;

  // 3. Upsert de cada misión (detalle) por (Carnet, MisionID).
  const resultadoDetalle = [];
  for (const d of detalle) {
    const r = await new sql.Request(tx)
      .input('carnet', sql.VarChar(25), maestro.carnet)
      .input('misionId', sql.Int, d.misionId)
      .input('estado', sql.Bit, d.estado)
      .query(`
        UPDATE dbo.EstudianteMisiones WITH (UPDLOCK, HOLDLOCK)
           SET Estado = @estado
         WHERE Carnet = @carnet AND MisionID = @misionId;
        IF @@ROWCOUNT = 0
        BEGIN
          INSERT INTO dbo.EstudianteMisiones (Carnet, MisionID, Estado) VALUES (@carnet, @misionId, @estado);
          SELECT 'insertada' AS Accion;
        END
        ELSE
          SELECT 'actualizada' AS Accion;
      `);
    resultadoDetalle.push({ misionId: d.misionId, estado: d.estado, accion: r.recordset[0].Accion });
  }

  return {
    estudiante: { ...maestro, accion: estudianteInsertado ? 'insertado' : 'actualizado' },
    detalle: resultadoDetalle,
  };
}

/** Traduce errores de SQL Server conocidos a errores HTTP. */
function mapSqlError(err) {
  if (err instanceof HttpError) return err;
  // 2627/2601: violación de UNIQUE (p. ej. correo ya usado por otro carnet)
  if (err && (err.number === 2627 || err.number === 2601)) {
    return new HttpError(409, 'Conflicto: el correo ya está registrado para otro estudiante.', err.message);
  }
  // 547: violación de FOREIGN KEY
  if (err && err.number === 547) {
    return new HttpError(422, 'Error de referencia en la base de datos.', err.message);
  }
  return null;
}

module.exports = { HttpError, validarPayload, procesarRegistro, mapSqlError };

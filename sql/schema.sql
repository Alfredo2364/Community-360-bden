IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.admins') AND type in (N'U'))
BEGIN
    CREATE TABLE dbo.admins (
        id INT IDENTITY(1,1) PRIMARY KEY,
        email NVARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(40) NOT NULL DEFAULT 'admin',
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.usuarios') AND type in (N'U'))
BEGIN
    CREATE TABLE dbo.usuarios (
        id_usuario VARCHAR(20) NOT NULL PRIMARY KEY,
        alias NVARCHAR(100) NOT NULL,
        fecha_ingreso DATE NOT NULL,
        pais NVARCHAR(100) NULL,
        estado NVARCHAR(100) NULL,
        ciudad NVARCHAR(100) NULL,
        latitud FLOAT NULL,
        longitud FLOAT NULL,
        zona_horaria VARCHAR(80) NULL,
        rango_edad VARCHAR(20) NOT NULL,
        especie_fursona NVARCHAR(60) NOT NULL,
        interes_principal NVARCHAR(100) NOT NULL,
        plataforma_principal NVARCHAR(50) NOT NULL,
        es_artista BIT NOT NULL DEFAULT 0,
        mensajes_30d INT NOT NULL DEFAULT 0,
        reacciones_30d INT NOT NULL DEFAULT 0,
        eventos_asistidos INT NOT NULL DEFAULT 0,
        comisiones_compradas INT NOT NULL DEFAULT 0,
        sentimiento_promedio FLOAT NOT NULL DEFAULT 0,
        ultima_actividad DATE NOT NULL,
        estatus VARCHAR(30) NOT NULL,
        consentimiento_datos VARCHAR(10) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.usuario_intereses') AND type in (N'U'))
BEGIN
    CREATE TABLE dbo.usuario_intereses (
        id INT IDENTITY(1,1) PRIMARY KEY,
        id_usuario VARCHAR(20) NOT NULL,
        interes NVARCHAR(100) NOT NULL,
        tipo_interes VARCHAR(30) NOT NULL DEFAULT 'principal',
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_usuario_intereses_usuarios FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuarios(id_usuario) ON DELETE CASCADE,
        CONSTRAINT UQ_usuario_interes UNIQUE (id_usuario, interes)
    );
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_usuarios_plataforma_estatus' AND object_id = OBJECT_ID('dbo.usuarios'))
BEGIN
    CREATE INDEX IX_usuarios_plataforma_estatus ON dbo.usuarios(plataforma_principal, estatus);
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_usuario_intereses_interes' AND object_id = OBJECT_ID('dbo.usuario_intereses'))
BEGIN
    CREATE INDEX IX_usuario_intereses_interes ON dbo.usuario_intereses(interes);
END;

MERGE INTO dbo.admins AS target
USING (
    SELECT
        N'lizandro.reyes@utmetropolitana.edu.mx' AS email,
        '$2a$10$qs3OW2F6Dagc0tZ48i5GOupsPsINSiibZgHr3TzHqmqHTMUfBh42i' AS password_hash,
        'docente' AS rol
) AS src
ON LOWER(target.email) = LOWER(src.email)
WHEN MATCHED THEN
    UPDATE SET
        target.password_hash = src.password_hash,
        target.rol = src.rol
WHEN NOT MATCHED THEN
    INSERT (email, password_hash, rol)
    VALUES (src.email, src.password_hash, src.rol);


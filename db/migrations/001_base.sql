-- 001: tablas base (departamentos, empleados, proyectos, festivos).
-- Sin datos sensibles: CURP, RFC, NSS y salario llegan con el módulo Ficha de Empleado.
-- Cada migración se ejecuta una sola vez, dentro de una transacción. No usar GO.

CREATE TABLE departments (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_departments PRIMARY KEY,
    name        NVARCHAR(100)     NOT NULL CONSTRAINT UQ_departments_name UNIQUE,
    is_active   BIT               NOT NULL CONSTRAINT DF_departments_is_active DEFAULT 1
);

CREATE TABLE employees (
    id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_employees PRIMARY KEY,
    employee_number  NVARCHAR(20)      NOT NULL CONSTRAINT UQ_employees_number UNIQUE,
    full_name        NVARCHAR(200)     NOT NULL,
    -- Correo corporativo: con él se enlaza el usuario autenticado con su ficha.
    email            NVARCHAR(254)     NOT NULL CONSTRAINT UQ_employees_email UNIQUE,
    -- ID de objeto en Entra ID. Reservado por si el enlace pasa a hacerse por ID (duda 9).
    entra_object_id  UNIQUEIDENTIFIER  NULL,
    department_id    INT               NULL CONSTRAINT FK_employees_department REFERENCES departments (id),
    -- Quien tiene empleados con su id aquí es Supervisor / Responsable.
    supervisor_id    INT               NULL CONSTRAINT FK_employees_supervisor REFERENCES employees (id),
    is_active        BIT               NOT NULL CONSTRAINT DF_employees_is_active DEFAULT 1,
    created_at       DATETIME2(0)      NOT NULL CONSTRAINT DF_employees_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_employees_not_own_supervisor CHECK (supervisor_id IS NULL OR supervisor_id <> id)
);

CREATE INDEX IX_employees_supervisor ON employees (supervisor_id);
CREATE UNIQUE INDEX UQ_employees_entra_object_id ON employees (entra_object_id) WHERE entra_object_id IS NOT NULL;

-- Analíticas / proyectos a los que se imputan las horas.
CREATE TABLE projects (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_projects PRIMARY KEY,
    code        NVARCHAR(20)      NOT NULL CONSTRAINT UQ_projects_code UNIQUE,
    name        NVARCHAR(200)     NULL,
    is_active   BIT               NOT NULL CONSTRAINT DF_projects_is_active DEFAULT 1
);

-- Festivos oficiales. Quién los mantiene sigue pendiente (duda 3).
CREATE TABLE holidays (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_holidays PRIMARY KEY,
    holiday_date  DATE              NOT NULL CONSTRAINT UQ_holidays_date UNIQUE,
    name          NVARCHAR(100)     NOT NULL
);

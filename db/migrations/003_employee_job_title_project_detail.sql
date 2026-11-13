-- 003: puesto del empleado y detalle del proyecto.
-- Lo mínimo de la Ficha de Empleado que necesita el Parte de Horas.

ALTER TABLE employees ADD job_title NVARCHAR(100) NULL;

-- Algunas analíticas comparten nombre y se distinguen por un detalle.
ALTER TABLE projects ADD detail NVARCHAR(200) NULL;

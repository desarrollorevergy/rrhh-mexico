-- 008: fecha de ingreso del empleado.
-- De ella sale la antigüedad, con la que se calcula el saldo de vacaciones (módulo 08).
-- Opcional: las fichas ya creadas no la tienen hasta que RRHH la capture.

ALTER TABLE employees ADD hire_date DATE NULL;

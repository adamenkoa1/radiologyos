-- Видаляємо мертву таблицю `equipment`: жоден маршрут її не читає й не пише.
-- Конфігурація обладнання живе у lib/catalog (константа EQUIPMENT) і в
-- налаштуванні `equipment_schedule` (lib/schedule), а блокування — в окремій
-- таблиці `equipment_blocks`. Дублювання прибрано.
DROP TABLE IF EXISTS `equipment`;

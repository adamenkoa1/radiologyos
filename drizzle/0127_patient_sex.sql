-- Стать пацієнта в картці (A: реальні пацієнти). Сумісна, неруйнівна зміна:
-- додаємо колонку з дефолтом '' (не вказано) — наявні картки не чіпаємо.
-- Інлайн CHECK на рівні колонки (SQLite дозволяє в ADD COLUMN без перебудови
-- таблиці) дублює валідацію застосунку: допустимі '', female, male, other.
ALTER TABLE `patient_profiles` ADD `sex` text DEFAULT '' NOT NULL CHECK (`sex` IN ('', 'female', 'male', 'other'));

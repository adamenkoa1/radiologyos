-- Структуровані параметри дослідження: анатомічна ділянка (кілька, кома-ключі)
-- і метод контрастування. Сумісна, неруйнівна зміна — ADD COLUMN із дефолтом ''
-- («не вказано»), наявні дослідження не чіпаємо. Ділянку/контраст НЕ виводимо з
-- вільного тексту — лише явний структурований ввід. Інлайн CHECK на колонці
-- контрастування (SQLite дозволяє в ADD COLUMN без перебудови таблиці).
ALTER TABLE `bookings` ADD `anatomical_regions` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookings` ADD `contrast_method` text DEFAULT '' NOT NULL CHECK (`contrast_method` IN ('', 'none', 'iv', 'oral'));

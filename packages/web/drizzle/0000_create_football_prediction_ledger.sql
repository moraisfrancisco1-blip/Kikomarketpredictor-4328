CREATE TABLE IF NOT EXISTS `football_prediction_ledger` (
  `prediction_id` text PRIMARY KEY NOT NULL,
  `fixture_date` text NOT NULL,
  `recorded_at` text NOT NULL,
  `home` text NOT NULL,
  `away` text NOT NULL,
  `prob_home` real NOT NULL,
  `prob_draw` real NOT NULL,
  `prob_away` real NOT NULL,
  `outcome` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `football_prediction_fixture_idx` ON `football_prediction_ledger` (`fixture_date`,`home`,`away`,`prediction_id`);

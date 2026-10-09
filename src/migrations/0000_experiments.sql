CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`name` text NOT NULL,
	`problem` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_name_unique` ON `experiments` (`name`);
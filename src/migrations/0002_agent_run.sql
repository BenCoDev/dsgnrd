CREATE TABLE `citations` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`from` integer NOT NULL,
	`to` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `citations_idx_from` ON `citations` (`from`);--> statement-breakpoint
CREATE INDEX `citations_idx_to` ON `citations` (`to`);--> statement-breakpoint
CREATE UNIQUE INDEX `citations_from_to_experiment_unique` ON `citations` (`from`,`to`,`experiment`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`agent` integer NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_experiment_agent_position_unique` ON `messages` (`experiment`,`agent`,`position`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`author` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`abstract` text NOT NULL,
	`status` text NOT NULL,
	`reference` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_experiment_reference_unique` ON `publications` (`experiment`,`reference`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`publication` integer NOT NULL,
	`author` integer NOT NULL,
	`grade` text,
	`content` text,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reviews_idx_publication` ON `reviews` (`publication`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_author_publication_unique` ON `reviews` (`author`,`publication`);--> statement-breakpoint
CREATE TABLE `solutions` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`publication` integer,
	`agent` integer NOT NULL,
	`reason` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `solutions_idx_experiment_agent_created` ON `solutions` (`experiment`,`agent`,`created`);--> statement-breakpoint
CREATE TABLE `token_usages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`agent` integer NOT NULL,
	`message` integer NOT NULL,
	`total` integer NOT NULL,
	`input` integer NOT NULL,
	`output` integer NOT NULL,
	`cached` integer NOT NULL,
	`thinking` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `token_usages_idx_experiment_agent` ON `token_usages` (`experiment`,`agent`);
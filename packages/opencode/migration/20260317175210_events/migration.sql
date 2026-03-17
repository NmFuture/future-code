CREATE TABLE `event_sequence` (
	`aggregate_id` text PRIMARY KEY,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
	`seq` integer NOT NULL,
	`aggregateId` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_event_aggregateId_event_sequence_aggregate_id_fk` FOREIGN KEY (`aggregateId`) REFERENCES `event_sequence`(`aggregate_id`) ON DELETE CASCADE
);

// Build against these until the hub is live. Same files the hub tests use.
import checkin from "../../shared/schemas/examples/checkin.json";
import hazard from "../../shared/schemas/examples/hazard.json";
import caseEvent from "../../shared/schemas/examples/case.json";
import missing from "../../shared/schemas/examples/missing_person.json";
import type { HollowEvent } from "./types";

export const fakeEvents = [checkin, hazard, caseEvent, missing] as HollowEvent[];

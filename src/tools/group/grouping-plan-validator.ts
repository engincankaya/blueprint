export class GroupingPlanValidator {
  normalize(plan: unknown): { plan?: unknown; error?: string } {
    if (typeof plan !== "string") {
      return { plan };
    }

    if (plan.trim() === "") {
      return {
        error: "Invalid GroupingPlan: plan must be valid JSON when provided as a string",
      };
    }

    try {
      return { plan: JSON.parse(plan) };
    } catch {
      return {
        error: "Invalid GroupingPlan: plan must be valid JSON when provided as a string",
      };
    }
  }

  validate(plan: unknown): string[] {
    const errors: string[] = [];
    if (!this.isRecord(plan)) return ["plan must be a JSON object, not a JSON string"];
    this.validateProject(plan, errors);
    if (!Array.isArray(plan.groups) || plan.groups.length === 0) {
      return [...errors, "groups must be a non-empty array"];
    }

    this.validateGroups(plan.groups, errors);
    this.validateFallback(plan.fallback, errors);
    return errors;
  }

  private validateProject(plan: Record<string, unknown>, errors: string[]): void {
    if (plan.project === undefined) return;

    if (!this.isRecord(plan.project)) {
      errors.push("project must be an object when provided");
      return;
    }

    if (
      plan.project.summary !== undefined
      && (typeof plan.project.summary !== "string" || plan.project.summary.trim() === "")
    ) {
      errors.push("project.summary must be a non-empty string when provided");
    }
  }

  private validateGroups(groups: unknown[], errors: string[]): void {
    const ids = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (!this.isRecord(group)) {
        errors.push(`groups[${index}] must be an object`);
        continue;
      }

      this.validateGroupIdentity(group, index, ids, errors);
      this.validateGroupPatterns(group, index, errors);
    }
  }

  private validateGroupIdentity(
    group: Record<string, unknown>,
    index: number,
    ids: Set<string>,
    errors: string[],
  ): void {
    if (typeof group.id !== "string" || group.id.trim() === "") {
      errors.push(`groups[${index}].id is required`);
    } else if (ids.has(group.id)) {
      errors.push(`duplicate group id: ${group.id}`);
    } else {
      ids.add(group.id);
    }

    if (typeof group.name !== "string" || group.name.trim() === "") {
      errors.push(`groups[${index}].name is required`);
    }
  }

  private validateGroupPatterns(
    group: Record<string, unknown>,
    index: number,
    errors: string[],
  ): void {
    if (!Array.isArray(group.include) || group.include.length === 0) {
      errors.push(`groups[${index}].include must be a non-empty array`);
    } else if (!group.include.every((pattern) => typeof pattern === "string" && pattern.length > 0)) {
      errors.push(`groups[${index}].include must contain only non-empty strings`);
    }

    if (
      group.exclude !== undefined
      && (!Array.isArray(group.exclude)
        || !group.exclude.every((pattern) => typeof pattern === "string" && pattern.length > 0))
    ) {
      errors.push(`groups[${index}].exclude must contain only non-empty strings`);
    }
  }

  private validateFallback(fallback: unknown, errors: string[]): void {
    if (
      fallback !== undefined
      && (!this.isRecord(fallback) || fallback.strategy !== "folder-category")
    ) {
      errors.push("fallback.strategy must be folder-category when provided");
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

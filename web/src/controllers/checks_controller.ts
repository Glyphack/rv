import { Controller } from "@hotwired/stimulus";

export default class ChecksController extends Controller {
  static targets = ["status", "output"];

  declare readonly statusTarget: HTMLElement;
  declare readonly outputTarget: HTMLElement;

  connect() {
    this.refresh();
  }

  async refresh() {
    this.statusTarget.textContent = "loading…";
    this.outputTarget.textContent = "";

    try {
      const res = await fetch("/api/checks");
      const data = await res.json();
      this.statusTarget.textContent = data.status;
      this.statusTarget.className = this.statusClasses(data.status);

      let output = "";
      if (data.checks && data.checks.length > 0) {
        output = data.checks
          .map((check: any) => `${check.passed ? "✓" : "✗"} ${check.name}`)
          .join("\n");
      }

      if (data.error) {
        if (output) output += "\n\n─── Error Details ───\n";
        output += data.error;
      }

      this.outputTarget.textContent = output;
    } catch {
      this.statusTarget.textContent = "error";
      this.statusTarget.className = "text-xs font-medium text-red-500";
    }
  }

  private statusClasses(status: string): string {
    switch (status) {
      case "pass":
        return "text-xs font-medium text-emerald-600";
      case "fail":
        return "text-xs font-medium text-red-500";
      default:
        return "text-xs font-medium text-gray-400";
    }
  }
}

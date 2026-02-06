import { Application } from "@hotwired/stimulus";

import ChecksController from "./controllers/checks_controller";
import ReviewController from "./controllers/review_controller";

declare global {
  interface Window {
    Stimulus: Application;
  }
}

window.Stimulus = Application.start();
window.Stimulus.register("checks", ChecksController);
window.Stimulus.register("review", ReviewController);

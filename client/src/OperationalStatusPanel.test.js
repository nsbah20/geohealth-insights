import { render, screen } from "@testing-library/react";
import OperationalStatusPanel from "./OperationalStatusPanel";

test("hides operational details from non-administrators", () => {
  render(<OperationalStatusPanel authUser={{ canAdmin: false }} />);

  expect(screen.getByText(/Administrator access is required/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Refresh Status/i })).not.toBeInTheDocument();
});

test("shows monitoring controls to administrators", () => {
  render(<OperationalStatusPanel authUser={{ canAdmin: true }} loadOnMount={false} />);

  expect(screen.getByRole("button", { name: /Refresh Status/i })).toBeInTheDocument();
  expect(screen.getByText("Database")).toBeInTheDocument();
  expect(screen.getByText("Session Signing")).toBeInTheDocument();
});

// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { createHappyDomRootHarness } from "./testRootHarness";

const { mount } = createHappyDomRootHarness();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(props: Partial<ComponentProps<typeof TimelineEmptyState>>) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() =>
    mount(host).render(
      <TimelineEmptyState
        isDragOver={false}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onDrop={() => undefined}
        {...props}
      />,
    ),
  );
  return host;
}

describe("TimelineEmptyState", () => {
  it("prompts by default", () => {
    expect(render({}).textContent).toContain("Describe your video to start creating");
  });

  it("shows the host's message in place of the prompt", () => {
    const text = render({ message: "Add a line to start" }).textContent;
    expect(text).toContain("Add a line to start");
    expect(text).not.toContain("Describe your video");
  });

  it("shows the empty lanes alone for a null message", () => {
    const host = render({ message: null });
    expect(host.textContent).not.toContain("Describe your video");
    expect(host.querySelector(".border-dashed")).toBeNull();
  });

  it("still shows the drop hint while a drag it takes is over it", () => {
    expect(render({ message: null, isDragOver: true }).textContent).toContain(
      "Drop media files to import",
    );
  });
});

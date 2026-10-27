// A DOM action: resize on text changes and wrapping changes without touching focus.
export function autoSize(element: HTMLTextAreaElement, _text: string) {
  function resize() {
    element.style.height = 'auto';
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + border}px`;
  }
  let width = -1;
  let frame = 0;
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(resize);
  });
  observer.observe(element);
  resize();
  return {
    update: resize,
    destroy: () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

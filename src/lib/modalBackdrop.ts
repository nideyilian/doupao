export interface ModalBackdropEvent {
  target: EventTarget | null
  currentTarget: EventTarget | null
}

export function isModalBackdropEvent(event: ModalBackdropEvent) {
  return event.target === event.currentTarget
}

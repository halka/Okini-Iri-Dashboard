export function byId<T = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} was not found`);
  return element as T;
}

export function formControl<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  form: HTMLFormElement,
  name: string
): T {
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLElement)) throw new Error(`Required form control "${name}" was not found`);
  return control as T;
}

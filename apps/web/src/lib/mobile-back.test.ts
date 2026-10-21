import { beforeEach,expect,it,vi } from 'vitest';
import { consumeMobileBack, registerMobileBack } from './mobile-back';
beforeEach(()=>{document.body.innerHTML='';});
it('closes the front dialog and expanded menu before returning to its page',()=>{
  const page=vi.fn(()=>true), dispose=registerMobileBack(page,0);
  const dialog=document.createElement('dialog');dialog.open=true;document.body.append(dialog);
  const cancel=vi.fn((event:Event)=>{event.preventDefault();dialog.remove();});dialog.addEventListener('cancel',cancel);
  expect(consumeMobileBack()).toBe(true);expect(cancel).toHaveBeenCalledOnce();expect(page).not.toHaveBeenCalled();
  const details=document.createElement('details');details.open=true;document.body.append(details);
  expect(consumeMobileBack()).toBe(true);expect(details.open).toBe(false);expect(page).not.toHaveBeenCalled();
  expect(consumeMobileBack()).toBe(true);expect(page).toHaveBeenCalledOnce();dispose();
});
it('gives the latest modal priority and does not consume the home screen back action',()=>{
  const page=vi.fn(()=>false), modal=vi.fn(()=>true);
  const first=registerMobileBack(page,0), second=registerMobileBack(modal,100);
  expect(consumeMobileBack()).toBe(true);expect(modal).toHaveBeenCalledOnce();expect(page).not.toHaveBeenCalled();
  second();expect(consumeMobileBack()).toBe(false);expect(page).toHaveBeenCalledOnce();first();
});

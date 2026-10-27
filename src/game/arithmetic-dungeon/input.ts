// 整数题输入与「开门」按钮联动：真实键入实时启用按钮，点击提交读取当前输入值
// （首尾空白裁剪后交给判题流程）。元素以最小结构接口注入（HTMLInputElement/
// HTMLButtonElement 结构兼容），使联动行为可在 Node 测试中无 DOM 模拟；
// 本模块不判题、不持有游戏状态，非作答状态由调用方置 input.disabled 统一收敛。
export interface IntegerInputLike {
  readonly disabled: boolean;
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

export interface IntegerSubmitButtonLike {
  disabled: boolean;
  addEventListener(type: string, listener: () => void): void;
}

/** 按当前输入同步按钮可用性：输入禁用（非作答状态）或输入为空时禁用。 */
export function syncIntegerSubmit(input: IntegerInputLike, button: IntegerSubmitButtonLike): void {
  button.disabled = input.disabled || input.value.trim() === '';
}

/** 接线：input 事件实时联动按钮；点击提交仅在按钮可用时提交当前输入值。 */
export function wireIntegerSubmit(
  input: IntegerInputLike,
  button: IntegerSubmitButtonLike,
  submit: (rawValue: string) => void,
): void {
  input.addEventListener('input', () => syncIntegerSubmit(input, button));
  button.addEventListener('click', () => {
    if (!button.disabled) submit(input.value.trim());
  });
  syncIntegerSubmit(input, button);
}

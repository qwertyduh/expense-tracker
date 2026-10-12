import Svg, { Circle, Path, Rect } from 'react-native-svg';

type WalletArrowProps = {
  size?: number;
  color?: string;
};

/**
 * Wallet with an arrow leaving it — "money out" (add expense).
 * Arrow points up and to the right, exiting the wallet.
 */
export function WalletArrowOut({ size = 24, color = '#FFFFFF' }: WalletArrowProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Wallet body */}
      <Rect x="2.5" y="8" width="19" height="12" rx="3" stroke={color} strokeWidth="1.7" />
      <Path d="M2.5 11.5h19" stroke={color} strokeWidth="1.7" />
      <Circle cx="17.5" cy="14.5" r="1.4" fill={color} />
      {/* Outgoing arrow (up-right) */}
      <Path
        d="M10 14.5 15 9.5"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <Path
        d="M10.75 9.5H15v4.25"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Wallet with an arrow entering it — "money in" (receive).
 * Arrow points down and to the left, into the wallet.
 */
export function WalletArrowIn({ size = 24, color = '#FFFFFF' }: WalletArrowProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Wallet body */}
      <Rect x="2.5" y="8" width="19" height="12" rx="3" stroke={color} strokeWidth="1.7" />
      <Path d="M2.5 11.5h19" stroke={color} strokeWidth="1.7" />
      <Circle cx="17.5" cy="14.5" r="1.4" fill={color} />
      {/* Incoming arrow (down-left) */}
      <Path
        d="M15 9.5 10 14.5"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <Path
        d="M14.25 14.5H10V10.25"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

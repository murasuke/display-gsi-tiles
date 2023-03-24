/**
 * 経度から座標(タイルとタイル内pixcel)を計算
 * @param lng 経度
 * @param z zoomlevel
 * @returns
 */
export const calcCoordX = (lng: number, z: number) => {
  // ラジアンに変換
  const lng_rad = (Math.PI / 180) * lng;

  // zoomレベル0の場合、256pxで360度(2PIラジアン)
  //  ⇒ ラジアンあたりpxを計算
  const R = 256 / (2 * Math.PI);

  // グリニッジ子午線を原点とした位置(x) (-128～128)
  let worldCoordX = R * lng_rad;

  // 左端を原点にするために180度分を加算する(0～256)
  worldCoordX = worldCoordX + R * (Math.PI / 180) * 180;

  // 1周256px換算で計算した値にzoomをかけて、zoomで換算した画像の位置を計算
  //  ⇒ https://maps.gsi.go.jp/development/siyou.html#siyou-zm
  const pixelCoordX = worldCoordX * Math.pow(2, z);

  // 1つの画像が256pxなので、256で割って左端からの画像の枚数(タイルの位置)を求める
  // (0オリジンなので切り捨て)
  const tileCoordX = Math.floor(pixelCoordX / 256);

  // 左側のタイル幅合計を引いて、表示タイル内のpx位置を算出する
  const imagePosX = Math.floor(pixelCoordX - tileCoordX * 256);

  // 計算した値を返す
  return {
    worldCoordX,
    pixelCoordX,
    tileCoordX,
    imagePosX,
  };
};

/**
 * 緯度から座標(タイルとタイル内pixcel)を計算
 * メルカトル図法で緯度から位置を算出する式 (https://qiita.com/Seo-4d696b75/items/aa6adfbfba404fcd65aa)
 *  R ln(tan(π/4 + ϕ/2))
 *    R: 半径
 *    ϕ: 緯度(ラジアン)
 * @param lat 緯度
 * @param z zoomlevel
 * @returns
 */
export const calcCoordY = (lat: number, z: number) => {
  // ラジアン
  const lat_rad = (Math.PI / 180) * lat;

  // zoomレベル0の場合、256pxで360度(2PIラジアン)
  //  ⇒ ラジアンあたりpxを計算
  const R = 256 / (2 * Math.PI);

  // メルカトル図法で緯度から位置を算出
  let worldCoordY = R * Math.log(Math.tan(Math.PI / 4 + lat_rad / 2));

  // 赤道からの位置(北緯)で計算しているので、左上を原点とするため軸を逆転＋北極側を原点に換算
  worldCoordY = -1 * worldCoordY + 128;

  // 256px換算で計算した値にzoomをかけて、zoomで換算した画像の位置を計算
  const pixelCoordY = worldCoordY * Math.pow(2, z);

  // 1つの画像が256pxなので、256で割って左端からの画像の枚数(位置)を求める
  // 0オリジンなので切り捨て
  const tileCoordY = Math.floor(pixelCoordY / 256);

  // 上側のタイル幅合計を引いて、表示タイル内のpx位置を算出する
  const imagePosY = Math.floor(pixelCoordY - tileCoordY * 256);

  // 計算した値を返す
  return {
    worldCoordY,
    pixelCoordY,
    tileCoordY,
    imagePosY,
  };
};

/**
 * 指定位置に該当するタイル位置と、該当タイル内の位置を返す
 * @param lat 緯度
 * @param lng 経度
 * @param z zoomlevel
 * @returns
 */
export const calcTileInfo = (lat: number, lng: number, z: number) => {
  // (x, y): 指定位置に該当するタイル位置
  // (pX, pY): 該当タイル内の位置
  const coordX = calcCoordX(lng, z);
  const coordY = calcCoordY(lat, z);
  return {
    x: coordX.tileCoordX,
    y: coordY.tileCoordY,
    pX: coordX.imagePosX,
    pY: coordY.imagePosY,
    z,
  };
};

/**
 * タイルを読み込みHTMLImageElementを返す
 *
 * @param x
 * @param y
 * @param z
 * @param option
 * @returns
 */
export const loadTile = (
  x: number,
  y: number,
  z: number,
  option: { dataType: string; ext?: string }
) => {
  const { dataType, ext } = option;

  const url = `https://cyberjapandata.gsi.go.jp/xyz/${dataType}/${z}/${x}/${y}.${
    ext ?? 'png'
  }`;
  const img = new Image();
  img.setAttribute('crossorigin', 'anonymous');
  img.src = url;
  return img;
};

/**
 * dem5aから標高を取得
 * @param lat
 * @param lng
 */
export const getElevation = async (
  lat: number,
  lng: number
): Promise<number> => {
  const z = 15;

  // 描画用のCanvasを用意する
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [256, 256];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // タイルを取得
  const { x, y, pX, pY } = calcTileInfo(lat, lng, z);
  // タイルを読み込む<img>タグを作成
  const img = loadTile(x, y, z, { dataType: 'dem5a_png' });

  // onloadは非同期で発生するため、Promise()でラップして返す
  return new Promise((resolve, reject) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      // ピクセルカラー配列を取得
      const { data } = ctx.getImageData(0, 0, 256, 256);
      // 1pxあたり4Byte(RGBA)
      const idx = pY * 256 * 4 + pX * 4;
      const r = data[idx + 0];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // 標高に換算
      let h: number | undefined = undefined;
      const resolution = 0.01; // 分解能

      // 定義に従い計算
      // x = 2^16R + 2^8G + B
      // x < 2^23の場合　h = xu
      // x = 2^23の場合　h = NA
      // x > 2^23の場合　h = (x-2^24)u
      // uは標高分解能（0.01m）
      const x = r * 2 ** 16 + g * 2 ** 8 + b;
      if (x < 2 ** 23) {
        h = x * resolution;
      } else if (x == 2 ** 23) {
        h = undefined;
      } else if (x > 2 ** 23) {
        h = x - 2 ** 24 * resolution;
      }

      resolve(h);
    };
  });
};

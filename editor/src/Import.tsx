import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { readFileAsync } from "./Utils";
import { MapController } from "./utils/MapController";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";
import { useTranslation } from "react-i18next";
import { FogMap } from "./utils/FogMap";
import { FeatureCollection, Geometry } from 'geojson';
import { kml, gpx } from "@tmcw/togeojson";

type Props = {
  mapController: MapController;
  isOpen: boolean;
  setIsOpen(isOpen: boolean): void;
  msgboxShow(title: string, msg: string): void;
};

function getFileExtension(filename: string): string {
  return filename.slice(
    (Math.max(0, filename.lastIndexOf(".")) || Infinity) + 1
  );
}

export async function createMapFromZip(data: ArrayBuffer): Promise<FogMap> {
  const zip = await new JSZip().loadAsync(data);
  const tileFiles = await Promise.all(
    Object.entries(zip.files)
      .map(([filename, file]) => {
        filename = filename.replace(/^.*[\\/]/, "");
        return [filename, file] as [string, JSZip.JSZipObject];
      })
      .filter(([filename, _file]) => {
        return filename != "";
      })
      .map(async ([filename, file]) => {
        const data = await file.async("arraybuffer");
        return [filename, data] as [string, ArrayBuffer];
      })
  );
  const map = FogMap.createFromFiles(tileFiles);
  return map;
}

export async function createPathFromGPX(data: ArrayBuffer, textDecoder: TextDecoder, domParser: DOMParser): Promise<FeatureCollection> {
  const dataAsText = textDecoder.decode(data);
  const doc = domParser.parseFromString(dataAsText, "application/xml");

  return gpx(doc);
}

export async function createPathFromKML(data: ArrayBuffer, textDecoder: TextDecoder, domParser: DOMParser): Promise<FeatureCollection> {
  const dataAsText = textDecoder.decode(data);
  const doc = domParser.parseFromString(dataAsText, "application/xml");

  return kml(doc) as FeatureCollection<Geometry>;
}

export default function MyModal(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { isOpen, setIsOpen, msgboxShow } = props;

  async function importFiles(files: File[]) {
    const mapController = props.mapController;
    closeModal();
    if (mapController.fogMap !== FogMap.empty) {
      // we need this because we do not support overriding in `mapRenderer.addFoGFile`
      msgboxShow("error", "error-already-imported");
      return;
    }

    console.log(files);
    // TODO: error handling
    // TODO: progress bar
    // TODO: improve file checking
    let done = false;
    files.forEach((file) => console.log(getFileExtension(file.name)));

    // const kmlAndGpxFiles = files.filter((file) => ["kml", "gpx"].includes(getFileExtension(file.name)));
    // const remainingFiles = files.filter((file) => !["kml", "gpx"].includes(getFileExtension(file.name)));

    // files.forEach((file, idx) => uniqueList[idx] = multiTypes.includes(getFileExtension(file.name)) ? 1 : 0);

    const groupedFiles = files.reduce((acc, file) => {
      const extension = getFileExtension(file.name);

      if (!acc[extension]) {
        acc[extension] = [file];
      } else {
        acc[extension].push(file);
      }

      return acc;
    }, {} as { [key: string]: File[] });

    if ("zip" in groupedFiles) {
      if (mapController.fogMap !== FogMap.empty) {
        // we need this because we do not support overriding in `mapRenderer.addFoGFile`
        msgboxShow("error", "error-already-imported");
        return;
      }

      const files = groupedFiles["zip"]

      const data = await readFileAsync(files[0]);
      if (data instanceof ArrayBuffer) {
        const map = await createMapFromZip(data);
        mapController.replaceFogMap(map);
      }
      done = true;
    }

    if ("" in groupedFiles) {
      if (mapController.fogMap !== FogMap.empty) {
        // we need this because we do not support overriding in `mapRenderer.addFoGFile`
        msgboxShow("error", "error-already-imported");
        return;
      }

      const files = groupedFiles[""]

      if (files.every((file) => getFileExtension(file.name) === "")) {
        const tileFiles = await Promise.all(
          files.map(async (file) => {
            const data = await readFileAsync(file);
            return [file.name, data] as [string, ArrayBuffer];
          })
        );
        const map = FogMap.createFromFiles(tileFiles);
        mapController.replaceFogMap(map);
        done = true;
      }
    }

    let textDecoder: TextDecoder | null = null;
    let domParser: DOMParser | null = null;

    if ("gpx" in groupedFiles) {
      if (!textDecoder) {
        textDecoder = new TextDecoder("utf-8");
        domParser = new DOMParser();
      }
      const files = groupedFiles["gpx"]

      const geoJsonList = files.map(async (gpxFile) => {
        const data = await readFileAsync(gpxFile);
        if (data instanceof ArrayBuffer) {
          const map = await createMapFromZip(data);
          mapController.replaceFogMap(map);
          return await createPathFromGPX(data, textDecoder as TextDecoder, domParser as DOMParser);
        }
      });

      mapController.performBulkImport(await Promise.all(geoJsonList));

      done = true;
    }
    
    if ("kml" in groupedFiles) {
      if (!textDecoder) {
        textDecoder = new TextDecoder("utf-8");
        domParser = new DOMParser();
      }
      const files = groupedFiles["kml"]

      const geoJsonList = files.map(async (kmlFile) => {
        const data = await readFileAsync(kmlFile);
        if (data instanceof ArrayBuffer) {
          return await createPathFromKML(data, textDecoder as TextDecoder, domParser as DOMParser);
        }
      });

      mapController.performBulkImport(await Promise.all(geoJsonList));

      done = true;
    }

    if (done) {
      // TODO: move to center?
    } else {
      msgboxShow("error", "error-invalid-format");
    }
  }

  const { open, getRootProps, getInputProps } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (files) => importFiles(files),
  });
  const openFileSelector = open;

  function closeModal() {
    setIsOpen(false);
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-40 overflow-y-auto"
        onClose={closeModal}
      >
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Overlay className="fixed inset-0" />
          </Transition.Child>

          {/* This element is to trick the browser into centering the modal contents. */}
          <span
            className="inline-block h-screen align-middle"
            aria-hidden="true"
          >
            &#8203;
          </span>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-gray-900"
              >
                {t("import")}
              </Dialog.Title>
              <div className="mt-2">
                <p
                  className="text-sm text-gray-500"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {t("import-dialog-description")}
                </p>
              </div>
              <div className="pt-4">
                <div className="border-2 border-dashed border-gray-300 border-opacity-100 rounded-lg">
                  <div {...getRootProps({ className: "dropzone" })}>
                    <input {...getInputProps()} />
                    <div className="py-4 w-min mx-auto">
                      <div className="mb-4 whitespace-nowrap">
                        {t("import-dialog-drag-and-drop")}
                      </div>
                      <div className="w-min mx-auto">
                        <button
                          type="button"
                          className="whitespace-nowrap px-4 py-2 text-sm font-medium text-blue-900 bg-blue-100 border border-transparent rounded-md hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                          onClick={openFileSelector}
                        >
                          {t("import-dialog-select")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}

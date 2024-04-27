import { useRef, useState } from "react";
import {
  Card,
  Button,
  Tabs,
  Tab,
  Spinner,
  InputGroup,
  Form,
  Modal,
  Dropdown,
  ButtonGroup,
} from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../../store/index";
import { selectProgramText } from "../../../store/programInfo/selectors/selectProgramText";
import { Icon } from "../../Icon";
import { TextTooltip } from "../../TextTooltip";
import {
  createNemoWorker,
  NemoProgramInfo,
  NemoWorker,
} from "../../../nemoWorker/NemoWorker";
import { PredicateResults } from "./results/PredicateResults";
import { FactCounts } from "../../../nemoWorker/NemoRunner";
import "./ExecutionPanel.css";
import { chooseFile } from "../../../chooseFile";
import { downloadPredicate } from "./downloadPredicate";
import { toastsSlice } from "../../../store/toasts";
import { Evonne } from "./evonne/Evonne";

function convertFileSize(size: number) {
  let index = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1000));
  if (index > 4) {
    index = 4;
  }
  return (
    (size / Math.pow(1000, index)).toFixed(1) +
    " " +
    ["B", "KB", "MB", "GB", "TB"][index]
  );
}

enum TracingFormat {
  NONE,
  ASCII,
  EVONNE,
}

export function ExecutionPanel() {
  const { t } = useTranslation("executionPanel");

  const dispatch = useAppDispatch();

  const [inputs, setInputs] = useState<{ resource: string; file: File }[]>([]);
  const [activeKey, setActiveKey] = useState("info");
  const workerRef = useRef<NemoWorker | undefined>(undefined);
  const [programInfo, setProgramInfo] = useState<NemoProgramInfo | undefined>(
    undefined,
  );
  const [parseError, setParseError] = useState<string | undefined>(undefined);
  const [initializationDuration, setInitializationDuration] =
    useState<number>(0);
  const [reasoningDuration, setReasoningDuration] = useState<number>(0);
  const [factCounts, setFactCounts] = useState<FactCounts | undefined>(
    undefined,
  );
  const [isProgramRunning, setIsProgramRunning] = useState(false);
  const [isWorkerActive, setIsWorkerActive] = useState(false);
  const [tracingFactText, setTracingFactText] = useState("");
  const [tracingResult, setTracingResult] = useState<string | undefined>(
    undefined,
  );
  const [tracingFormat, setTracingFormat] = useState(TracingFormat.NONE);

  const [isTracingModalShown, setIsTracingModalShown] = useState(false);

  const programText = useAppSelector(selectProgramText);

  const stopProgram = () => {
    setActiveKey("info");
    if (workerRef.current !== undefined) {
      // Terminate web worker
      workerRef.current.stop();
      workerRef.current = undefined;
    }
    setProgramInfo(undefined);
    setParseError(undefined);
    setInitializationDuration(0);
    setReasoningDuration(0);
    setFactCounts(undefined);
    setIsProgramRunning(false);
  };

  const runProgram = async () => {
    stopProgram();

    setIsProgramRunning(true);

    try {
      const worker = await createNemoWorker(setIsWorkerActive);
      workerRef.current = worker;
      console.debug("[ExecutionPanel] Created Nemo worker", worker);

      setProgramInfo(await worker.parseProgram(programText));

      await worker.markDefaultExports();

      const info = await worker.start(
        Object.fromEntries(
          inputs
            .map((input) => [input.resource, input.file])
            .filter((input) => input[1] !== undefined),
        ),
      );
      setInitializationDuration(info.initializationDuration);
      setReasoningDuration(info.reasoningDuration);

      setFactCounts(await worker.getCounts());
    } catch (error) {
      console.warn(
        "[ExecutionPanel] Error while parsing/running program",
        error,
      );
      setParseError((error as any).toString());
    }

    setIsProgramRunning(false);
  };

  const isTracingCurrentlyAllowed = () => {
    return programInfo !== undefined && !isWorkerActive;
  };

  const traceFactAscii = async () => {
    if (!isTracingCurrentlyAllowed() || workerRef.current === undefined) {
      return;
    }

    try {
      const tracingResult =
        await workerRef.current.parseAndTraceFactAscii(tracingFactText);

      setTracingFormat(TracingFormat.ASCII);
      setTracingResult(tracingResult);
    } catch (error) {
      setTracingFormat(TracingFormat.NONE);
      setTracingResult((error as any).toString());
    }
  };

  const traceFactEvonne = async () => {
    if (!isTracingCurrentlyAllowed() || workerRef.current === undefined) {
      return;
    }

    try {
      const tracingResult =
        await workerRef.current.parseAndTraceFactGraphML(tracingFactText);

      setTracingFormat(TracingFormat.EVONNE);
      setTracingResult(tracingResult);
    } catch (error) {
      setTracingFormat(TracingFormat.NONE);
      setTracingResult((error as any).toString());
    }
  };

  return (
    <>
      <Card>
        <Card.Header>
          {t("cardTitle")}
          {isWorkerActive ? (
            <TextTooltip
              text="Web worker is currently active"
              tooltipID="execution-panel-worker-active-tooltip"
            >
              <span className="ms-2">
                <Spinner size="sm" variant="secondary" animation="grow" />
              </span>
            </TextTooltip>
          ) : undefined}
          <span className="float-end">
            <TextTooltip
              tooltipID="main-execution-panel-help-tooltip"
              text={t("panelExplanation")}
            >
              <span>
                <Icon name="question-circle-fill" />
              </span>
            </TextTooltip>
          </span>
        </Card.Header>
        <Card.Body>
          <h4>Local inputs</h4>
          {inputs.map((input, inputIndex) => (
            <div key={inputIndex} className="mb-2">
              <InputGroup>
                <TextTooltip
                  text={`@import myPredName :- csv{resource="${input.resource}"} .`}
                  tooltipID={"execution-panel-input-tooltip-" + inputIndex}
                >
                  <Form.Control
                    type="text"
                    size="sm"
                    value={input.resource}
                    onChange={(event) => {
                      const newInputs = [...inputs];
                      newInputs[inputIndex] = {
                        ...inputs[inputIndex],
                        resource: event.target.value,
                      };
                      setInputs(newInputs);
                    }}
                  />
                </TextTooltip>
                <Button size="sm" variant="outline-secondary" disabled>
                  {convertFileSize(input.file.size)}
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    chooseFile((fileList) => {
                      if (fileList.length === 0) {
                        return;
                      }
                      const file = fileList[0];
                      const newInputs = [...inputs];
                      newInputs[inputIndex] = {
                        ...inputs[inputIndex],
                        file,
                      };
                      setInputs(newInputs);
                    });
                  }}
                >
                  <Icon name="file-earmark-spreadsheet"></Icon>
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    const newInputs = [...inputs];
                    newInputs.splice(inputIndex, 1);
                    setInputs(newInputs);
                  }}
                >
                  <Icon name="x"></Icon>
                </Button>
              </InputGroup>
            </div>
          ))}
          <Button
            variant="outline-secondary"
            onClick={() => {
              chooseFile((fileList) => {
                if (fileList.length === 0) {
                  return;
                }
                const file = fileList[0];
                setInputs(
                  inputs.concat([
                    {
                      resource: file.name,
                      file: file,
                    },
                  ]),
                );
              });
            }}
          >
            <Icon name="plus-square-dotted"></Icon> Add local file
          </Button>

          <hr />
          {isProgramRunning ? (
            <>
              <Button className="me-1 my-1" onClick={runProgram}>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                <span className="visually-hidden">Loading...</span>
                Re-run program
              </Button>
              <Button
                className="me-1 my-1"
                variant="outline-danger"
                onClick={stopProgram}
              >
                Stop
              </Button>
            </>
          ) : (
            <>
              <Dropdown as={ButtonGroup} className="me-1 my-1">
                <Button onClick={runProgram}>Run program</Button>

                <Dropdown.Toggle
                  split
                  variant="primary"
                  id="execution-panel-run-button"
                />

                <Dropdown.Menu>
                  <Dropdown.Item
                    onClick={() => setIsTracingModalShown(true)}
                    disabled={!isTracingCurrentlyAllowed()}
                  >
                    Open tracing panel
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </>
          )}

          {parseError === undefined ? (
            <></>
          ) : (
            <>
              <hr />
              <h4>Errors</h4>
              <br />
              <code className="execution-panel-code-display">{parseError}</code>
            </>
          )}
          {programInfo === undefined ? (
            <></>
          ) : (
            <>
              <hr />
              <h4>Outputs</h4>
              <Tabs
                activeKey={activeKey}
                onSelect={async (newActiveKey) => {
                  if (newActiveKey === null) {
                    return;
                  }
                  setActiveKey(newActiveKey);
                }}
                className="mb-3"
              >
                <Tab eventKey="info" title="Program info">
                  Parsing duration: {Math.ceil(programInfo.parsingDuration)} ms
                  <br />
                  Data loading/Reasoning duration:{" "}
                  {Math.ceil(initializationDuration + reasoningDuration)} ms
                  <br />
                  EDB predicates:{" "}
                  {Array.from(programInfo.edbPredicates).sort().join(", ")}
                  <br />
                  Output predicates:{" "}
                  {programInfo.outputPredicates.sort().join(", ")}
                  <br />
                  Count of facts for derived predicates:{" "}
                  {factCounts === undefined
                    ? "-"
                    : factCounts?.factsOfDerivedPredicates}
                </Tab>
                {programInfo === undefined ? (
                  <></>
                ) : (
                  Array.from(programInfo.outputPredicates.sort()).map(
                    (predicate) => {
                      const tabTitle =
                        predicate +
                        (factCounts !== undefined &&
                        predicate in factCounts.outputPredicates
                          ? ` (${factCounts.outputPredicates[predicate]})`
                          : "");

                      return (
                        <Tab
                          key={predicate}
                          eventKey={"predicate-" + predicate}
                          title={tabTitle}
                          disabled={factCounts === undefined}
                        >
                          {activeKey !== "predicate-" + predicate ? (
                            <></>
                          ) : (
                            <>
                              <h5>
                                Predicate results: <code>{predicate}</code>
                              </h5>
                              <div className="mb-2">
                                <span className="text-muted">
                                  {factCounts !== undefined &&
                                  predicate in factCounts.outputPredicates
                                    ? ` (${factCounts.outputPredicates[predicate]} rows)`
                                    : ""}{" "}
                                </span>
                                <a
                                  href="#"
                                  className="fst-italic text-decoration-none"
                                  onClick={async () => {
                                    if (workerRef.current === undefined) {
                                      return;
                                    }
                                    try {
                                      await downloadPredicate(
                                        workerRef.current,
                                        predicate,
                                      );
                                    } catch (error: any) {
                                      dispatch(
                                        toastsSlice.actions.addToast({
                                          title: "Error while downloading file",
                                          description: error.toString(),
                                          variant: "danger",
                                        }),
                                      );
                                    }
                                  }}
                                >
                                  <Icon name="file-earmark-arrow-down" />
                                  Download all rows as CSV
                                </a>
                              </div>
                              {factCounts !== undefined &&
                              predicate in factCounts.outputPredicates ? (
                                <PredicateResults
                                  workerRef={workerRef}
                                  predicate={predicate}
                                  numberOfRows={
                                    factCounts.outputPredicates[predicate]
                                  }
                                  onClickRow={(row) => {
                                    if (!isTracingCurrentlyAllowed()) return;

                                    setIsTracingModalShown(true);
                                    setTracingFactText(
                                      `${predicate}(${row.join(",")})`,
                                    );
                                  }}
                                />
                              ) : undefined}
                            </>
                          )}
                        </Tab>
                      );
                    },
                  )
                )}
              </Tabs>
            </>
          )}
        </Card.Body>
      </Card>

      <Modal
        show={isTracingModalShown}
        onHide={() => setIsTracingModalShown(false)}
        size="xl"
      >
        <Modal.Header closeButton>
          <Modal.Title>Fact tracing</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Tracing allows you to see the concrete rule invocations that lead to a
          fact being inferred.
          <hr />
          <h4>Input</h4>
          <Form.Group>
            <Form.Label>Fact that should be traced:</Form.Label>
            <InputGroup className="mb-3">
              <Form.Control
                type="text"
                value={tracingFactText}
                onChange={(event) => setTracingFactText(event.target.value)}
                placeholder="example: a(1)"
              />
              <Button
                variant="primary"
                disabled={!isTracingCurrentlyAllowed()}
                onClick={traceFactAscii}
              >
                ASCII Trace
              </Button>
              <Button
                variant="primary"
                disabled={!isTracingCurrentlyAllowed()}
                onClick={traceFactEvonne}
              >
                Evonne Trace
              </Button>
            </InputGroup>
          </Form.Group>
          <h4>Tracing results</h4>
          {tracingResult === undefined ||
          tracingFormat === TracingFormat.NONE ? (
            <>No results</>
          ) : tracingFormat === TracingFormat.EVONNE ? (
            <Evonne data={tracingResult} />
          ) : (
            /* tracingFormat === TracingFormat.ASCII */ <code className="execution-panel-code-display">
              {tracingResult}
            </code>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setIsTracingModalShown(false)}
          >
            {t("common:closeModal")}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

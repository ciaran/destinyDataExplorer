import Header from "components/Header";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHistory, useParams } from "react-router";

import { ensureSchema, getOperation } from "../../lib/apiSchemaUtils";

import s from "./styles.module.scss";
import {
  Collapsed,
  useApiParams,
  makeApiRequestUrl,
  invertCollapsed,
  makeUrl,
  Params,
} from "./utils";
import APIRequestEditor from "components/APIRequestEditor";
import DataViewsOverlay, {
  DefinitionEntry,
  parsePathParam,
} from "components/DataViewsOverlay";
import APIListOverlay from "components/APIListOverlay";
import { Link } from "react-router-dom";
import ResponseEmptyState from "components/ResponseEmptyState";
import APIResponseDataView from "components/APIResponseDataView";

interface ApiRequestViewProps {}

const ApiRequestView: React.FC<ApiRequestViewProps> = () => {
  const history = useHistory();
  const [menuOverlayVisible, setMenuOverlayVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>();
  const [collapsed, setCollapsed] = useState(Collapsed.Unselected);

  const { operationName, 0: splat } = useParams<{
    operationName?: string;
    "0"?: string;
  }>();

  const apiOperation = useMemo(
    () => (operationName ? getOperation(operationName) : undefined),
    [operationName]
  );

  const definitionEntries = useMemo(
    () => (splat ? parsePathParam(splat) : []),
    [splat]
  );

  const [apiParams, setApiParams] = useApiParams(apiOperation);

  // Clear state when the URL/operation changes
  useEffect(() => {
    setApiResponse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationName]);

  const handleSubmit = useCallback(() => {
    const url = makeApiRequestUrl(apiOperation, apiParams, true);

    setLoading(true);
    fetch(`https://www.bungie.net${url}`, {
      headers: {
        "x-api-key": process.env.REACT_APP_API_KEY ?? "",
      },
    })
      .then((response) => {
        return response.json();
      })
      .then((data) => {
        setLoading(false);
        setApiResponse(data);
      });
  }, [apiOperation, apiParams]);

  const linkedDefinitionUrl = useCallback(
    ({ type, hash }: DefinitionEntry) => {
      const newItems = [...definitionEntries, { type, hash }];
      return makeUrl(newItems, operationName, apiParams);
    },
    [definitionEntries, operationName, apiParams]
  );

  const requestPopOverlay = useCallback(() => {
    const newItems = [...definitionEntries];
    newItems.pop();
    history.push(makeUrl(newItems, operationName, apiParams));
  }, [definitionEntries, history, operationName, apiParams]);

  const handleParamsEdited = useCallback(
    (newParamsPartial: Params) => {
      setApiParams({ ...apiParams, ...newParamsPartial });
    },
    [apiParams, setApiParams]
  );

  const handleListOverlayClose = useCallback(() => {
    setMenuOverlayVisible(false);
    setCollapsed(Collapsed.Visible);
  }, []);

  const responseSchema =
    apiOperation && ensureSchema(apiOperation.responses?.["200"]);

  const isCollapsed =
    collapsed === Collapsed.Unselected
      ? !!apiResponse
      : collapsed === Collapsed.Collapsed;

  return (
    <>
      <div className={s.root}>
        <div className={s.request}>
          <Header className={s.header}>
            <div className={s.headerBody}>
              <span
                className={s.headerApiName}
                onClick={() => setMenuOverlayVisible(true)}
              >
                {apiOperation && (
                  <>
                    Request: <strong>{apiOperation.operationId}</strong>
                  </>
                )}
              </span>

              <div>
                <button
                  className={s.headerbutton}
                  onClick={() => setMenuOverlayVisible(true)}
                >
                  API Library
                </button>

                <Link className={s.headerbutton} to="/">
                  Back to Definitions
                </Link>
              </div>
            </div>
          </Header>

          <APIRequestEditor
            isLoading={loading}
            className={s.requestEditor}
            apiOperation={apiOperation}
            isCollapsed={isCollapsed}
            apiParams={apiParams}
            onPathParamsChange={handleParamsEdited}
            onQueryParamsChange={handleParamsEdited}
            onSubmit={handleSubmit}
            onToggleCollapsed={() =>
              setCollapsed((v) => invertCollapsed(v, isCollapsed))
            }
          />
        </div>

        <div className={s.response}>
          {apiResponse && responseSchema && operationName ? (
            <APIResponseDataView
              data={apiResponse}
              schema={responseSchema}
              operationName={operationName}
              linkedDefinitionUrl={linkedDefinitionUrl}
            />
          ) : (
            operationName && <ResponseEmptyState loading={loading} />
          )}
        </div>
      </div>

      <APIListOverlay
        visible={!operationName || menuOverlayVisible}
        onRequestClose={handleListOverlayClose}
      />

      <DataViewsOverlay
        items={definitionEntries}
        linkedDefinitionUrl={linkedDefinitionUrl}
        requestPopOverlay={requestPopOverlay}
      />
    </>
  );
};

export default ApiRequestView;
